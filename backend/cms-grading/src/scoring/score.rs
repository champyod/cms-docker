//! One submission result turned into the score row a scoring service writes.
//!
//! This module is the pure boundary between the records read from the database and
//! the score types: it performs no query and reads no clock. The dataset names the
//! score type and carries its parameters as text, the task supplies the published
//! precision, and the result and its evaluations supply the numbers to score.
//!
//! A missing or malformed evaluation is refused rather than treated as zero. A
//! compilation that never reached evaluation is different: the result's absent
//! evaluation outcome is handed to the score type, whose own zero or empty answer
//! is what the scoring service stores.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::collections::{BTreeMap, BTreeSet};
use std::num::ParseFloatError;

use chrono::NaiveDateTime;

use cms_db::{DatasetRecord, Evaluation, ScoreRow, SubmissionResult, Task, TestcaseRecord};

use crate::scoretypes::{Evaluated, ScoreType, ScoreTypeError, Submission};

/// The records one submission result is scored against.
#[derive(Debug, Clone, Copy)]
pub struct ScoringInput<'a> {
    /// The dataset whose score type, parameters and time limit are read.
    pub dataset: &'a DatasetRecord,
    /// The task whose score precision is read.
    pub task: &'a Task,
    /// The result whose key and evaluation flag are read.
    pub result: &'a SubmissionResult,
    /// The testcase runs recorded for the result.
    pub evaluations: &'a [Evaluation],
    /// Every testcase belonging to the dataset.
    pub testcases: &'a [TestcaseRecord],
}

/// Why one result could not be turned into a score row.
#[derive(Debug, thiserror::Error)]
pub enum ScoringError {
    /// The dataset's score parameters are not valid JSON.
    #[error("datasets.score_type_parameters is not valid JSON: {0}")]
    InvalidParameters(#[from] serde_json::Error),
    /// The task's published precision cannot be represented as a decimal count.
    #[error("tasks.score_precision is negative: {0}")]
    NegativePrecision(i32),
    /// An evaluation names a testcase outside the supplied dataset.
    #[error("evaluation {testcase_id} names a testcase outside the dataset")]
    UnknownTestcase {
        /// The testcase id the evaluation carries.
        testcase_id: i32,
    },
    /// An evaluated result has no run for a testcase its dataset holds.
    #[error("the result holds no evaluation for testcase {testcase_id}")]
    MissingEvaluation {
        /// The dataset testcase with no evaluation.
        testcase_id: i32,
    },
    /// An evaluation has no grader outcome to parse.
    #[error("evaluation {testcase_id} has no outcome")]
    MissingOutcome {
        /// The testcase whose evaluation has no outcome.
        testcase_id: i32,
    },
    /// An evaluation's grader outcome is not a number.
    #[error("evaluation {testcase_id} has malformed outcome {outcome:?}: {source}")]
    MalformedOutcome {
        /// The testcase whose evaluation is malformed.
        testcase_id: i32,
        /// The outcome text the grader stored.
        outcome: String,
        /// The number parser's refusal.
        #[source]
        source: ParseFloatError,
    },
    /// The named score type refused its parameters or the evaluated submission.
    #[error(transparent)]
    ScoreType(#[from] ScoreTypeError),
}

/// Turn one result and its evaluations into the row a scoring service writes.
///
/// # Errors
///
/// Returns [`ScoringError`] when the score parameters are not JSON, the task's
/// precision is negative, an evaluation names a testcase outside the dataset or
/// has no numeric outcome, or the score type refuses the dataset or submission.
/// An evaluated result missing a dataset testcase is refused by that testcase id.
pub fn score(input: &ScoringInput<'_>, scored_at: NaiveDateTime) -> Result<ScoreRow, ScoringError> {
    let parameters: serde_json::Value = serde_json::from_str(&input.dataset.score_type_parameters)?;
    let precision = score_precision(input.task)?;
    let score_type = ScoreType::of(
        &input.dataset.score_type,
        &parameters,
        public_testcases(input.testcases),
    )?;
    let testcases = evaluated_testcases(input)?;
    ensure_evaluations(input)?;
    let scored = score_type.compute_score(&Submission {
        evaluated: input.result.evaluation_outcome.is_some(),
        score_precision: precision,
        testcases,
    })?;

    Ok(ScoreRow {
        submission_id: input.result.submission_id,
        dataset_id: input.result.dataset_id,
        score: Some(scored.score),
        score_details: Some(scored.details_json().to_string()),
        scored_at: Some(scored_at),
        public_score: Some(scored.public_score),
        public_score_details: Some(scored.public_details_json().to_string()),
        ranking_score_details: Some(scored.ranking_details),
    })
}

/// The task's published precision as the nonnegative count the score types take.
fn score_precision(task: &Task) -> Result<u32, ScoringError> {
    u32::try_from(task.score_precision)
        .map_err(|_| ScoringError::NegativePrecision(task.score_precision))
}

/// The dataset's testcases by codename and their public visibility.
fn public_testcases(testcases: &[TestcaseRecord]) -> BTreeMap<String, bool> {
    testcases
        .iter()
        .map(|testcase| (testcase.codename.clone(), testcase.is_public))
        .collect()
}

/// The dataset's testcase ids mapped to the codenames its parameters select.
fn testcase_codenames(testcases: &[TestcaseRecord]) -> BTreeMap<i32, &str> {
    testcases
        .iter()
        .map(|testcase| (testcase.id, testcase.codename.as_str()))
        .collect()
}

/// Refuse an evaluated result that does not hold every testcase of its dataset.
fn ensure_evaluations(input: &ScoringInput<'_>) -> Result<(), ScoringError> {
    if input.result.evaluation_outcome.is_none() {
        return Ok(());
    }
    let evaluated: BTreeSet<i32> = input
        .evaluations
        .iter()
        .map(|evaluation| evaluation.testcase_id)
        .collect();
    for testcase in input.testcases {
        if !evaluated.contains(&testcase.id) {
            return Err(ScoringError::MissingEvaluation {
                testcase_id: testcase.id,
            });
        }
    }
    Ok(())
}

/// Every supplied evaluation in the value shape a score type reads.
fn evaluated_testcases(input: &ScoringInput<'_>) -> Result<Vec<Evaluated>, ScoringError> {
    let codenames = testcase_codenames(input.testcases);
    input
        .evaluations
        .iter()
        .map(|evaluation| {
            let codename =
                codenames
                    .get(&evaluation.testcase_id)
                    .ok_or(ScoringError::UnknownTestcase {
                        testcase_id: evaluation.testcase_id,
                    })?;
            Ok(Evaluated {
                codename: (*codename).to_owned(),
                outcome: parse_outcome(evaluation)?,
                text: evaluation.text.clone(),
                time: evaluation.execution_time,
                time_limit: input.dataset.time_limit,
                memory: evaluation.execution_memory,
            })
        })
        .collect()
}

/// One grader outcome as the number the score type awards.
fn parse_outcome(evaluation: &Evaluation) -> Result<f64, ScoringError> {
    let outcome = evaluation
        .outcome
        .as_deref()
        .ok_or(ScoringError::MissingOutcome {
            testcase_id: evaluation.testcase_id,
        })?;
    outcome
        .parse()
        .map_err(|source| ScoringError::MalformedOutcome {
            testcase_id: evaluation.testcase_id,
            outcome: outcome.to_owned(),
            source,
        })
}
