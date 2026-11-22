//! Why a task type did not compile, run, or read back a job.
//!
//! One error for the five task types, because a job is refused by the phase that could
//! not do its part whatever the task is, and a caller that catches one of these is
//! catching all of them. Every variant names the two things that disagree or the file to
//! look at, so a refusal says which manager, limit or count.
//!
//! A verdict about a submission is never one of these: an answer that is wrong, a
//! checker that could not run and a file the run never wrote are all facts the task
//! type reports, not failures of the worker.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::fmt;

use serde_json::Value;

use crate::stage::StageError;
use crate::steps::StepError;
use cms_sandbox::SpawnError;

use super::parameters::Accepts;

/// Why a job was not compiled, not run, or not read back.
#[derive(Debug)]
pub enum TaskError {
    /// The task type parameters are not the entries the task type declares: not a list,
    /// or not one entry per declared parameter.
    Parameters,
    /// A declared parameter was given a value it does not accept.
    ///
    /// The declaration's own name, what it accepts and the value it refused are carried
    /// because the reference's per-type messages say all three, and they are what an
    /// administrator has to correct in a dataset's parameters: "not the entries a Batch
    /// task has" names no parameter at all.
    Parameter {
        /// The name the declaration gives the parameter.
        name: &'static str,
        /// What the declaration accepts for it.
        accepts: Accepts,
        /// The value the declaration refused.
        value: Value,
    },
    /// The dataset holds no manager of the name a grader compilation needs.
    MissingManager {
        /// The manager the compilation needs and the dataset does not hold.
        name: String,
    },
    /// The submission's file count is not what the task type takes: fewer than a
    /// floor, or not exactly a fixed number.
    TooFewFiles {
        /// How many files the submission carries.
        found: usize,
        /// How many are required.
        wanted: usize,
    },
    /// The result holds a number of executables an evaluation does not expect.
    UnexpectedExecutables {
        /// How many executables the result holds.
        found: usize,
        /// How many are expected.
        wanted: usize,
    },
    /// A limit the dataset set is not a positive number, and so bounds nothing.
    NonPositiveLimit {
        /// Which of the two limits was set to it.
        limit: &'static str,
        /// The value the dataset set.
        value: f64,
    },
    /// An answer was described by both a path and a digest, or by neither.
    OutputSource,
    /// A job asked for an answer to be judged against a correct one it does not carry.
    NoCorrectOutput,
    /// A file the run was to be handed could not be staged.
    Stage(StageError),
    /// A run could not be launched, or could not be read back once it had run.
    Spawn(SpawnError),
    /// A checker could not be staged or launched.
    Step(StepError),
}

impl fmt::Display for TaskError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Parameters => {
                write!(
                    f,
                    "the task type parameters are not the entries the task type declares"
                )
            }
            Self::Parameter {
                name,
                accepts,
                value,
            } => write!(f, "parameter `{name}` {accepts}, not {value}"),
            Self::MissingManager { name } => {
                write!(f, "the dataset is missing manager `{name}`")
            }
            Self::TooFewFiles { found, wanted } => {
                write!(f, "the submission has {found} files, {wanted} are required")
            }
            Self::UnexpectedExecutables { found, wanted } => {
                write!(
                    f,
                    "the result has {found} executables, {wanted} are expected"
                )
            }
            Self::NonPositiveLimit { limit, value } => {
                write!(f, "the {limit} must be positive, is {value}")
            }
            Self::OutputSource => write!(
                f,
                "exactly one of an answer's path and its digest must be given"
            ),
            Self::NoCorrectOutput => {
                write!(f, "the job carries no correct answer to compare with")
            }
            Self::Stage(error) => write!(f, "{error}"),
            Self::Spawn(error) => write!(f, "{error}"),
            Self::Step(error) => write!(f, "{error}"),
        }
    }
}

impl std::error::Error for TaskError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Stage(error) => Some(error),
            Self::Spawn(error) => Some(error),
            Self::Step(error) => Some(error),
            _ => None,
        }
    }
}

impl From<StageError> for TaskError {
    fn from(error: StageError) -> Self {
        Self::Stage(error)
    }
}

impl From<SpawnError> for TaskError {
    fn from(error: SpawnError) -> Self {
        Self::Spawn(error)
    }
}

impl From<StepError> for TaskError {
    fn from(error: StepError) -> Self {
        match error {
            StepError::Stage(error) => Self::Stage(error),
            StepError::Spawn(error) => Self::Spawn(error),
        }
    }
}
