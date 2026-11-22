//! What a submission is worth, by the score type a dataset's `score_type` column names.
//!
//! Four score types, one registry, and the two shapes they come in. [`Sum`] weighs every
//! testcase on its own and adds them up; [`Group`] divides the testcases into subtasks and
//! scores each subtask as a fraction of its weight, reduced by [`Reduction`]: the smallest
//! outcome, the product of them, or full weight where every outcome is above zero and at
//! most a threshold.
//!
//! The reduction is a `match` over a closed set rather than a trait method the three group
//! types implement, because a score type is chosen by a name in the database: a new one is
//! code in this crate, and the match is the one place the compiler makes whoever adds it
//! visit. A trait would let a caller construct a type [`ScoreType::of`] cannot name, which
//! is not a thing a column can select.
//!
//! What is handed in is a [`Submission`] — a flag for whether it was evaluated, the
//! precision its task publishes at, and one [`Evaluated`] per testcase — and what comes
//! back is a [`Scored`]: the score, the document behind it, the score over the public
//! testcases alone, that document, and one string per subtask for the ranking server. The
//! documents are typed, and a testcase a contestant may not see is a [`Row::Hidden`] rather
//! than a flag, so a hidden outcome cannot reach a page by a forgotten branch.
//!
//! What a score reads as is [`format_score`]'s, which is a rule about a number already
//! decided: the rounding a task publishes at and the rounding a panel shows are two
//! different rules, and only one of them is the score.
//!
//! # Errors
//!
//! [`ScoreTypeError`], and only that: a name the registry does not hold, parameters that
//! are not the entries the named type takes, subtasks that select their testcases two
//! ways, a pattern this crate does not read, one that matches nothing, a subtask with no
//! testcase in it, and a result missing a testcase the parameters select.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

mod error;
mod format;
mod group;
mod params;
mod pattern;
mod reduce;
mod submission;
mod subtask;
mod sum;

pub use error::ScoreTypeError;
pub use format::{format_decimal, format_general, format_score, round_at};
pub use group::Group;
pub use reduce::Reduction;
pub use submission::{
    Evaluated, MaxScores, Row, ScoreDetails, Scored, Submission, Subtask, SumRow, Testcase,
};
pub use sum::Sum;

use std::collections::BTreeMap;

use serde_json::Value;

/// A score type, with the parameters and public testcases it was built from.
#[derive(Debug, Clone, PartialEq)]
pub enum ScoreType {
    /// The sum of the testcases, each worth its own weight.
    Sum(Sum),
    /// Subtasks of testcases, each worth the fraction its reduction gives.
    Group(Group),
}

impl ScoreType {
    /// The score type the `score_type` column names, or a refusal naming it.
    ///
    /// # Errors
    ///
    /// Returns [`ScoreTypeError::UnknownName`] for a name this crate does not implement,
    /// which is a refusal rather than a fallback: scoring a task with a type nobody chose
    /// would publish a number the dataset never asked for. The rest of [`ScoreTypeError`]
    /// is the named type's own refusal of its parameters.
    pub fn of(
        name: &str,
        parameters: &Value,
        public_testcases: BTreeMap<String, bool>,
    ) -> Result<Self, ScoreTypeError> {
        match name {
            "Sum" => Ok(Self::Sum(Sum::new(parameters, public_testcases)?)),
            "GroupMin" => Ok(Self::Group(Group::new(
                Reduction::Min,
                parameters,
                public_testcases,
            )?)),
            "GroupMul" => Ok(Self::Group(Group::new(
                Reduction::Mul,
                parameters,
                public_testcases,
            )?)),
            "GroupThreshold" => Ok(Self::Group(Group::new(
                Reduction::Threshold,
                parameters,
                public_testcases,
            )?)),
            other => Err(ScoreTypeError::UnknownName {
                name: other.to_owned(),
            }),
        }
    }

    /// The most a submission can score, and the headers a ranking table shows.
    #[must_use]
    pub fn max_scores(&self) -> MaxScores {
        match self {
            Self::Sum(sum) => sum.max_scores(),
            Self::Group(group) => group.max_scores(),
        }
    }

    /// One submission, scored.
    ///
    /// # Errors
    ///
    /// Returns [`ScoreTypeError::MissingEvaluation`] for a testcase the parameters select
    /// and the result does not hold.
    pub fn compute_score(&self, submission: &Submission) -> Result<Scored, ScoreTypeError> {
        match self {
            Self::Sum(sum) => sum.compute_score(submission),
            Self::Group(group) => group.compute_score(submission),
        }
    }
}
