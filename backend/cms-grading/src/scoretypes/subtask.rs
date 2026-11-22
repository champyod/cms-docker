//! One subtask of a group score type: its rows, its fraction, and the two documents it
//! contributes.
//!
//! A subtask is read once and produces three things: the rows both documents are rendered
//! from, the fraction the reduction gives it, and the pair of entries the two documents
//! hold — the scored one an administrator sees, and either the same entry or the public
//! testcases alone for a contestant. The one rule here that is a contest rule rather than a
//! presentation detail is [`restrict`]: `Restricted` shows a contestant the public
//! testcases up to and including the lowest-scoring one, and `OI Restricted` shows only
//! that one.
//!
//! The row a contestant is not shown is part of the document rather than decided at
//! rendering time, because the outcome of a hidden testcase must not be in their document at
//! all: [`super::submission::Row::Hidden`] holds the codename and nothing else.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::collections::BTreeMap;

use super::error::ScoreTypeError;
use super::format::round_at;
use super::params::GroupParameter;
use super::submission::{Evaluated, Row, Subtask, Testcase};
use super::Group;
use crate::tasktypes::TIMED_OUT;

/// One subtask scored, with the two documents it contributes.
pub(super) struct Detail {
    /// The subtask as an administrator's page shows it.
    pub subtask: Subtask,
    /// The subtask as a contestant's page shows it: the same one where every testcase is
    /// public, and the public testcases alone where they are not.
    pub public_subtask: Subtask,
    /// What the subtask earned, before the task's precision is applied.
    pub score: f64,
}

impl Group {
    /// One subtask, with the rows both documents are rendered from.
    pub(super) fn subtask_of(
        &self,
        index: usize,
        parameter: &GroupParameter,
        evaluations: &BTreeMap<&str, &Evaluated>,
        precision: u32,
    ) -> Result<Detail, ScoreTypeError> {
        let mut rows = Vec::with_capacity(parameter.targets.len());
        let mut public_rows = Vec::with_capacity(parameter.targets.len());
        let mut lowest: Option<(usize, f64)> = None;
        for (position, codename) in parameter.targets.iter().enumerate() {
            let evaluated = evaluations.get(codename.as_str()).copied().ok_or_else(|| {
                ScoreTypeError::MissingEvaluation {
                    codename: codename.clone(),
                }
            })?;
            let public = self.publicity(codename);
            rows.push(self.row_of(codename, evaluated, parameter, public));
            if public {
                public_rows.push(rows[rows.len() - 1].clone());
                // The first of the lowest outcomes is the one the reference names.
                if lowest.is_none_or(|(_, score)| evaluated.outcome < score) {
                    lowest = Some((position, evaluated.outcome));
                }
            } else {
                public_rows.push(Row::Hidden {
                    index: codename.clone(),
                });
            }
        }
        let fraction = self.reduce(parameter, evaluations);
        if let Some((lowest, _)) = lowest {
            restrict(&mut rows, lowest, fraction);
        }
        Ok(self.detail_of(index, parameter, rows, public_rows, fraction, precision))
    }

    /// One testcase's row, before the feedback level decides whether it is shown.
    fn row_of(
        &self,
        codename: &str,
        evaluated: &Evaluated,
        parameter: &GroupParameter,
        public: bool,
    ) -> Row {
        Row::Shown(Testcase {
            index: codename.to_owned(),
            outcome: self.public_outcome(evaluated.outcome, parameter),
            text: evaluated.text.clone(),
            time: evaluated.time,
            time_limit: evaluated.time_limit,
            // Only a report of the timeout itself counts, not an argument that says it.
            time_limit_was_exceeded: evaluated.text.len() == 1 && evaluated.text[0] == TIMED_OUT,
            memory: evaluated.memory,
            show_in_restricted_feedback: public,
            show_in_oi_restricted_feedback: public,
        })
    }

    /// The subtask's two documents and what it earned.
    fn detail_of(
        &self,
        index: usize,
        parameter: &GroupParameter,
        rows: Vec<Row>,
        public_rows: Vec<Row>,
        fraction: f64,
        precision: u32,
    ) -> Detail {
        let score = fraction * parameter.max_score;
        let subtask = Subtask::Scored {
            index,
            score_fraction: fraction,
            score: round_at(score, precision),
            max_score: parameter.max_score,
            testcases: rows,
        };
        let public_subtask = if self.is_public(parameter) {
            subtask.clone()
        } else {
            Subtask::Unscored {
                index,
                testcases: public_rows,
            }
        };
        Detail {
            subtask,
            public_subtask,
            score,
        }
    }
}

/// Hides the testcases a partial subtask does not show at the two restricted levels.
///
/// `Restricted` shows the public testcases up to and including the lowest-scoring one, and
/// `OI Restricted` shows only that one, so a contestant learns which testcase to look at
/// without learning how many after it failed.
fn restrict(rows: &mut [Row], lowest: usize, fraction: f64) {
    if fraction >= 1.0 {
        return;
    }
    for (position, row) in rows.iter_mut().enumerate() {
        let Row::Shown(testcase) = row else {
            continue;
        };
        if !testcase.show_in_restricted_feedback {
            continue;
        }
        testcase.show_in_restricted_feedback = position <= lowest;
        testcase.show_in_oi_restricted_feedback = position == lowest;
    }
}
