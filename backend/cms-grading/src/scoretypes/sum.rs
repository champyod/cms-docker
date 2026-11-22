//! The score type whose score is the sum of its testcases, with no subtasks at all.
//!
//! `Sum` is the other branch of the shape: it is not a group type that happens to have one
//! group, it has no groups. Its parameter is a single number, what one testcase's outcome
//! is worth, and every testcase of the dataset contributes it. That is why the score is
//! not a fraction of anything and why its details document is a table of testcases rather
//! than a list of subtasks: there is no subtask to show a score next to.
//!
//! The sentence a testcase is shown with is decided on the weighted score rather than on
//! the outcome, because the parameter is what a correct testcase is worth: an outcome of
//! one is `Correct` only where the testcase is worth something.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::collections::BTreeMap;

use serde_json::Value;

use super::error::ScoreTypeError;
use super::params::sum_parameter;
use super::submission::{by_codename, MaxScores, ScoreDetails, Scored, Submission, SumRow};

/// The score type whose score is the sum of the testcases' outcomes, each weighted.
#[derive(Debug, Clone, PartialEq)]
pub struct Sum {
    parameter: f64,
    public_testcases: BTreeMap<String, bool>,
}

impl Sum {
    /// `Sum`, over the given parameter and public testcases.
    ///
    /// # Errors
    ///
    /// Returns [`ScoreTypeError::Parameters`] for a parameter that is not one number.
    pub fn new(
        parameters: &Value,
        public_testcases: BTreeMap<String, bool>,
    ) -> Result<Self, ScoreTypeError> {
        Ok(Self {
            parameter: sum_parameter(parameters)?,
            public_testcases,
        })
    }

    /// The most a submission can score: the parameter once per testcase.
    #[must_use]
    pub fn max_scores(&self) -> MaxScores {
        let mut score = 0.0;
        let mut public_score = 0.0;
        for public in self.public_testcases.values() {
            if *public {
                public_score += self.parameter;
            }
            score += self.parameter;
        }
        MaxScores {
            score,
            public_score,
            // Nothing is grouped, so a ranking table has no extra column to head.
            headers: Vec::new(),
        }
    }

    /// One submission, scored.
    ///
    /// # Errors
    ///
    /// Returns [`ScoreTypeError::MissingEvaluation`] for a testcase the dataset holds and
    /// the result does not, which would otherwise score as a number nobody read.
    pub fn compute_score(&self, submission: &Submission) -> Result<Scored, ScoreTypeError> {
        if !submission.evaluated {
            return Ok(Scored {
                score: 0.0,
                details: ScoreDetails::Testcases(Vec::new()),
                public_score: 0.0,
                public_details: ScoreDetails::Testcases(Vec::new()),
                ranking_details: Vec::new(),
            });
        }
        let evaluations = by_codename(&submission.testcases);
        let mut score = 0.0;
        let mut public_score = 0.0;
        let mut rows = Vec::with_capacity(self.public_testcases.len());
        let mut public_rows = Vec::with_capacity(self.public_testcases.len());
        for codename in self.public_testcases.keys() {
            let evaluated = evaluations.get(codename.as_str()).copied().ok_or_else(|| {
                ScoreTypeError::MissingEvaluation {
                    codename: codename.clone(),
                }
            })?;
            let weighted = evaluated.outcome * self.parameter;
            rows.push(SumRow::Shown {
                index: codename.clone(),
                outcome: self.public_outcome(weighted),
                text: evaluated.text.clone(),
                time: evaluated.time,
                memory: evaluated.memory,
            });
            if self.public_testcases[codename] {
                public_score += weighted;
                public_rows.push(rows[rows.len() - 1].clone());
            } else {
                public_rows.push(SumRow::Hidden {
                    index: codename.clone(),
                });
            }
            score += weighted;
        }
        Ok(Scored {
            score,
            details: ScoreDetails::Testcases(rows),
            public_score,
            public_details: ScoreDetails::Testcases(public_rows),
            // The ranking table has one column for this task, so there is nothing extra.
            ranking_details: Vec::new(),
        })
    }

    /// The sentence a testcase worth `weighted` is shown with.
    fn public_outcome(&self, weighted: f64) -> String {
        if weighted <= 0.0 {
            "Not correct"
        } else if weighted >= self.parameter {
            "Correct"
        } else {
            "Partially correct"
        }
        .to_owned()
    }
}
