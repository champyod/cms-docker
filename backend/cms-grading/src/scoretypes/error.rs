//! Why a dataset's score type was not built, or a submission not scored.
//!
//! One error for the four score types, because what refuses a score type is the same
//! whatever it is: a name the registry does not hold, parameters of another shape, a
//! subtask that selects nothing, and a result that is missing a testcase the parameters
//! name. Every variant carries the name or the index to look at, so an administrator
//! reading it knows which dataset column to fix.
//!
//! A wrong answer is never one of these. A testcase scoring zero and a subtask scoring
//! nothing are answers, and the whole point of a score type is to turn them into a
//! number rather than into a failure.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::fmt;

/// Why a score type was not built, or a submission not scored.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ScoreTypeError {
    /// The name the `score_type` column holds is one this crate does not implement.
    UnknownName {
        /// The name the column holds.
        name: String,
    },
    /// The parameters are not the value the named score type takes.
    Parameters {
        /// The score type that refused them.
        name: &'static str,
    },
    /// One subtask of the parameters is not the entry its score type takes.
    Group {
        /// The score type that refused it.
        name: &'static str,
        /// The position of the subtask in the parameters.
        index: usize,
    },
    /// The subtasks select their testcases in two ways, by count and by pattern.
    MixedSelectors,
    /// A subtask's pattern is more than the subset this crate reads.
    UnsupportedPattern {
        /// The pattern as the parameters hold it.
        pattern: String,
    },
    /// A subtask's pattern matches no testcase of the dataset.
    UnmatchedPattern {
        /// The pattern as the parameters hold it.
        pattern: String,
    },
    /// A subtask selects no testcase at all.
    EmptyGroup {
        /// The position of the subtask in the parameters.
        index: usize,
    },
    /// The result holds no evaluation for a testcase the subtask selects.
    MissingEvaluation {
        /// The codename the parameters select and the result does not hold.
        codename: String,
    },
}

impl fmt::Display for ScoreTypeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnknownName { name } => {
                write!(f, "the score type `{name}` is not one this worker has")
            }
            Self::Parameters { name } => {
                write!(f, "the parameters are not the ones {name} takes")
            }
            Self::Group { name, index } => {
                write!(f, "subtask {index} is not one of the entries {name} takes")
            }
            Self::MixedSelectors => write!(
                f,
                "the subtasks must all count their testcases or all name them by pattern"
            ),
            Self::UnsupportedPattern { pattern } => write!(
                f,
                "the pattern `{pattern}` holds a construct this worker does not read"
            ),
            Self::UnmatchedPattern { pattern } => {
                write!(f, "no testcase matches the pattern `{pattern}`")
            }
            Self::EmptyGroup { index } => write!(f, "subtask {index} selects no testcase"),
            Self::MissingEvaluation { codename } => write!(
                f,
                "the result holds no evaluation for the testcase `{codename}`"
            ),
        }
    }
}

impl std::error::Error for ScoreTypeError {}
