//! The `submission_results` row and the five states it moves through.
//!
//! `submission.py:278-639`: a result is keyed by the submission and the dataset it
//! judged, its status is derived from four flags rather than stored, and every
//! invalidation clears the score before the outcome it depends on (`:587-625`).

use sqlx::postgres::PgConnection;

use super::SubmissionError;
use crate::reads::{DatasetId, SubmissionId};
use crate::writes::{CompilationOutcome, EvaluationOutcome};

/// Where a result has got to (`submission.py:290-294`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SubmissionStatus {
    /// `COMPILING`: no compilation outcome is recorded, and a missing row reads as this.
    Compiling,
    /// `COMPILATION_FAILED`: the submission itself was rejected.
    CompilationFailed,
    /// `EVALUATING`: it compiled, and the testcases have not all run.
    Evaluating,
    /// `SCORING`: every testcase ran, and the score is not written yet.
    Scoring,
    /// `SCORED`: all five score fields hold a value.
    Scored,
}

/// The `submission_results` columns the state machine reads, writes and clears.
#[derive(Debug, Clone, PartialEq)]
pub struct SubmissionResult {
    /// `submission_results.submission_id`, half the row's key.
    pub submission_id: SubmissionId,
    /// `submission_results.dataset_id`, the other half.
    pub dataset_id: DatasetId,
    /// `compilation_outcome`, absent until compilation ends.
    pub compilation_outcome: Option<CompilationOutcome>,
    /// `compilation_tries`, the failures so far, which every invalidation resets.
    pub compilation_tries: i32,
    /// `evaluation_outcome`, absent until every testcase of the dataset has a row.
    pub evaluation_outcome: Option<EvaluationOutcome>,
    /// `evaluation_tries`, the failures so far, which every invalidation resets.
    pub evaluation_tries: i32,
    /// `score`, absent until a scoring pass writes it.
    pub score: Option<f64>,
    /// `score_details`, the `jsonb` document behind the score, carried as its text.
    pub score_details: Option<String>,
    /// `public_score`, what a contestant is shown.
    pub public_score: Option<f64>,
    /// `public_score_details`, the `jsonb` document behind the public score.
    pub public_score_details: Option<String>,
    /// `ranking_score_details`, the one row the ranking table shows.
    pub ranking_score_details: Option<Vec<String>>,
}

impl SubmissionResult {
    /// A result nothing has been written to, which reads as [`SubmissionStatus::Compiling`].
    #[must_use]
    pub const fn new(submission_id: SubmissionId, dataset_id: DatasetId) -> Self {
        Self {
            submission_id,
            dataset_id,
            compilation_outcome: None,
            compilation_tries: 0,
            evaluation_outcome: None,
            evaluation_tries: 0,
            score: None,
            score_details: None,
            public_score: None,
            public_score_details: None,
            ranking_score_details: None,
        }
    }

    /// The status this row's flags spell, in the reference's order (`submission.py:436-449`).
    ///
    /// A failed compilation is returned before a score is looked at, so a result
    /// that is both rejected and scored reports the rejection.
    #[must_use]
    pub fn status(&self) -> SubmissionStatus {
        if !self.compiled() {
            SubmissionStatus::Compiling
        } else if self.compilation_failed() {
            SubmissionStatus::CompilationFailed
        } else if !self.evaluated() {
            SubmissionStatus::Evaluating
        } else if !self.scored() {
            SubmissionStatus::Scoring
        } else {
            SubmissionStatus::Scored
        }
    }

    /// Whether an outcome is recorded at all, which is what `compiled()` reads.
    #[must_use]
    pub const fn compiled(&self) -> bool {
        self.compilation_outcome.is_some()
    }

    /// Whether that outcome is `fail`, which is a rejection of the submission itself.
    #[must_use]
    pub fn compilation_failed(&self) -> bool {
        self.compilation_outcome == Some(CompilationOutcome::Fail)
    }

    /// Whether that outcome is `ok`, which is what an executable exists for.
    #[must_use]
    pub fn compilation_succeeded(&self) -> bool {
        self.compilation_outcome == Some(CompilationOutcome::Ok)
    }

    /// Whether an evaluation outcome is recorded, which is what `evaluations != []` means.
    #[must_use]
    pub const fn evaluated(&self) -> bool {
        self.evaluation_outcome.is_some()
    }

    /// Whether all five score fields hold a value (`submission.py:565-574`).
    #[must_use]
    pub fn scored(&self) -> bool {
        self.score.is_some()
            && self.score_details.is_some()
            && self.public_score.is_some()
            && self.public_score_details.is_some()
            && self.ranking_score_details.is_some()
    }

    /// Whether a scoring pass is owed: compiled away or fully evaluated, and unscored.
    #[must_use]
    pub fn needs_scoring(&self) -> bool {
        (self.compilation_failed() || self.evaluated()) && !self.scored()
    }

    /// Records the compilation outcome the sandbox reported.
    pub fn set_compilation_outcome(&mut self, success: bool) {
        self.compilation_outcome = Some(if success {
            CompilationOutcome::Ok
        } else {
            CompilationOutcome::Fail
        });
    }

    /// Records that every testcase of the dataset ran.
    pub fn set_evaluation_outcome(&mut self) {
        self.evaluation_outcome = Some(EvaluationOutcome::Ok);
    }

    /// Clears the score, which every other invalidation does first.
    pub fn clear_score(&mut self) {
        self.score = None;
        self.score_details = None;
        self.public_score = None;
        self.public_score_details = None;
        self.ranking_score_details = None;
    }

    /// Clears the evaluation fields, and the score that reads them.
    ///
    /// The outcome describes the whole set, so clearing one testcase clears it too
    /// (`submission.py:609-615`).
    pub fn clear_evaluation(&mut self) {
        self.clear_score();
        self.evaluation_outcome = None;
        self.evaluation_tries = 0;
    }

    /// Clears compilation and, first, everything compiled output fed.
    pub fn clear_compilation(&mut self) {
        self.clear_evaluation();
        self.compilation_outcome = None;
        self.compilation_tries = 0;
    }

    /// Removes the evaluation rows and clears the fields that described them.
    ///
    /// # Errors
    ///
    /// Returns [`SubmissionError::Database`] for a delete the driver refused.
    pub async fn invalidate_evaluation(
        &mut self,
        connection: &mut PgConnection,
        testcase: Option<i32>,
    ) -> Result<(), SubmissionError> {
        sqlx::query(super::evaluation::DELETE_EVALUATIONS)
            .bind(self.submission_id.0)
            .bind(self.dataset_id.0)
            .bind(testcase)
            .execute(&mut *connection)
            .await?;
        self.clear_evaluation();
        Ok(())
    }

    /// Removes the executable and evaluation rows, then clears the fields describing them.
    ///
    /// # Errors
    ///
    /// Returns [`SubmissionError::Database`] for a delete the driver refused.
    pub async fn invalidate_compilation(
        &mut self,
        connection: &mut PgConnection,
    ) -> Result<(), SubmissionError> {
        sqlx::query(super::evaluation::DELETE_EXECUTABLES)
            .bind(self.submission_id.0)
            .bind(self.dataset_id.0)
            .execute(&mut *connection)
            .await?;
        self.invalidate_evaluation(connection, None).await?;
        self.compilation_outcome = None;
        self.compilation_tries = 0;
        Ok(())
    }
}

/// The columns one `submission_results` row is read with, bound to its key as `$1`, `$2`.
///
/// The two `jsonb` score documents are cast to text, because the model carries them
/// as the text the score type wrote rather than as a second document type.
pub const RESULT_BY_ID: &str = "\
    SELECT submission_id, dataset_id, compilation_outcome, compilation_tries,
           evaluation_outcome, evaluation_tries, score, score_details::text AS score_details,
           public_score, public_score_details::text AS public_score_details,
           ranking_score_details
    FROM submission_results
    WHERE submission_id = $1 AND dataset_id = $2";

/// One result by its key, or `None` when the pair has never been judged.
///
/// # Errors
///
/// Returns the driver's own error for a row it could not read.
pub async fn result_by_id(
    connection: &mut PgConnection,
    submission: SubmissionId,
    dataset: DatasetId,
) -> Result<Option<SubmissionResult>, sqlx::Error> {
    let row = sqlx::query_as::<_, ResultRow>(RESULT_BY_ID)
        .bind(submission.0)
        .bind(dataset.0)
        .fetch_optional(connection)
        .await?;
    row.map(SubmissionResult::try_from).transpose()
}

/// The driver-facing shape of a result row, before its two outcome columns are typed.
#[derive(Debug, sqlx::FromRow)]
struct ResultRow {
    submission_id: i32,
    dataset_id: i32,
    compilation_outcome: Option<String>,
    compilation_tries: i32,
    evaluation_outcome: Option<String>,
    evaluation_tries: i32,
    score: Option<f64>,
    score_details: Option<String>,
    public_score: Option<f64>,
    public_score_details: Option<String>,
    ranking_score_details: Option<Vec<String>>,
}

impl TryFrom<ResultRow> for SubmissionResult {
    type Error = sqlx::Error;

    /// # Errors
    ///
    /// Returns [`sqlx::Error::ColumnDecode`] naming the column when an enum column
    /// holds a value its enum does not declare.
    fn try_from(row: ResultRow) -> Result<Self, Self::Error> {
        Ok(Self {
            submission_id: SubmissionId(row.submission_id),
            dataset_id: DatasetId(row.dataset_id),
            compilation_outcome: outcome(
                "compilation_outcome",
                row.compilation_outcome,
                CompilationOutcome::parse,
            )?,
            compilation_tries: row.compilation_tries,
            evaluation_outcome: outcome(
                "evaluation_outcome",
                row.evaluation_outcome,
                EvaluationOutcome::parse,
            )?,
            evaluation_tries: row.evaluation_tries,
            score: row.score,
            score_details: row.score_details,
            public_score: row.public_score,
            public_score_details: row.public_score_details,
            ranking_score_details: row.ranking_score_details,
        })
    }
}

/// Parses one enum column, naming it when the value is outside the enum.
fn outcome<T>(
    column: &'static str,
    value: Option<String>,
    parse: impl Fn(&str) -> Option<T>,
) -> Result<Option<T>, sqlx::Error> {
    match value {
        None => Ok(None),
        Some(text) => parse(&text)
            .map(Some)
            .ok_or_else(|| sqlx::Error::ColumnDecode {
                index: column.to_string(),
                source: format!("{text:?} is not a value of {column}").into(),
            }),
    }
}
