#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::fmt;

use serde_json::Value;

use crate::stage::{ArchiveError, StageError};
use crate::steps::StepError;
use cms_sandbox::SpawnError;

use super::parameters::Accepts;

/// Why a job was not compiled, not run, or not read back.
#[derive(Debug)]
pub enum TaskError {
    /// Refuses an unknown registry key instead of falling back to another task type.
    UnknownName {
        /// The name the job carried, which the task row's `task_type` column holds.
        name: String,
    },
    /// Refuses a parameter list whose shape cannot describe the selected task.
    Parameters,
    /// Names the declaration and refused value so an administrator can correct it.
    Parameter {
        /// The name the declaration gives the parameter.
        name: &'static str,
        /// What the declaration accepts for it.
        accepts: Accepts,
        /// The value the declaration refused.
        value: Value,
    },
    /// A task that compiles or runs a program was given no toolchain.
    NoLanguage,
    /// The dataset holds no manager of the name a grader compilation needs.
    MissingManager {
        /// The manager the compilation needs and the dataset does not hold.
        name: String,
    },
    /// Refuses a submission that cannot satisfy the task type's file contract.
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
    /// A run's directory could not be archived and filed.
    Archive(ArchiveError),
    /// A run could not be launched, or could not be read back once it had run.
    Spawn(SpawnError),
    /// A checker could not be staged or launched.
    Step(StepError),
}

impl fmt::Display for TaskError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnknownName { name } => {
                write!(f, "the task type `{name}` is not one this worker has")
            }
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
            Self::NoLanguage => write!(f, "the job needs a language, but no toolchain was given"),
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
            Self::Archive(error) => write!(f, "{error}"),
            Self::Spawn(error) => write!(f, "{error}"),
            Self::Step(error) => write!(f, "{error}"),
        }
    }
}

impl std::error::Error for TaskError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Stage(error) => Some(error),
            Self::Archive(error) => Some(error),
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
