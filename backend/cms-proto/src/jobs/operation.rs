//! The operation a job performs and the shard that ran it.
//!
//! `action_finished` receives the shard as an argument of its own beside the
//! batch, while every job inside the batch carries the same shard in its own
//! `shard` key, because the worker stamps it on each job as it runs it. A
//! [`Shard`] is therefore a type of its own rather than a bare integer: the
//! operation next to it is two integers wide, and reading one as the other
//! would file a result under the wrong submission.
//!
//! [`Operation`] is the five-key record every result is filed under, and the
//! key set it must match is [`OPERATION_KEYS`].

use serde::Deserialize;
use serde_json::{Map, Value};

use super::keys::{check_key_set, field, read_name, OPERATION_KEYS};
use super::refusal::JobError;

/// The index of the worker that ran a job, in a type of its own.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Deserialize)]
#[serde(transparent)]
pub struct Shard(i64);

impl Shard {
    /// Wraps the index the worker pool uses to address one worker.
    #[must_use]
    pub const fn new(index: i64) -> Self {
        Self(index)
    }

    /// The index as the wire carries it.
    #[must_use]
    pub const fn get(self) -> i64 {
        self.0
    }

    /// Reads the `shard` key of a job, which the worker stamps on every job it
    /// runs.
    ///
    /// # Errors
    ///
    /// Returns [`JobError::MissingKey`] when the job has no such key, and
    /// [`JobError::WrongValue`] naming the key when the value is not an
    /// integer.
    pub fn read(object: &Map<String, Value>) -> Result<Self, JobError> {
        field(object, "shard").map(Self)
    }
}

/// The four operation types `ESOperation.type_` names, as `to_dict` writes them.
///
/// This is the operation's own discriminator and has nothing to do with the job
/// `type`: a compilation job and an evaluation job may each perform any of the
/// four, and a user test compiles and evaluates the same way a submission does.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum OperationKind {
    /// `ESOperation.COMPILATION`, a submission compilation.
    Compilation,
    /// `ESOperation.EVALUATION`, a submission evaluation.
    Evaluation,
    /// `ESOperation.USER_TEST_COMPILATION`, a user test compilation.
    UserTestCompilation,
    /// `ESOperation.USER_TEST_EVALUATION`, a user test evaluation.
    UserTestEvaluation,
}

/// The operation a job performs: what to run, on what, against which testcase.
///
/// Every id here is part of what identifies the work, so a result filed under
/// the wrong one is a result nobody will ever read.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Operation {
    /// Which of the four operations this is.
    pub kind: OperationKind,
    /// Id of the submission or user test the operation is for.
    pub object_id: i64,
    /// Id of the dataset the operation runs against.
    pub dataset_id: i64,
    /// Codename of the single testcase an evaluation runs, null when the
    /// operation covers the whole dataset.
    pub testcase_codename: Option<String>,
    /// Whether the sandbox is to be archived, which is part of the key
    /// `write_results` groups by.
    pub archive_sandbox: bool,
}

impl Operation {
    /// Reads one operation, refusing it unless its keys are exactly
    /// [`OPERATION_KEYS`].
    ///
    /// The operation is one level inside the job, so this check is the second
    /// of the two: a job whose operation carries a sixth key is refused here and
    /// the job is quarantined with that key named.
    ///
    /// # Errors
    ///
    /// Returns [`JobError`] naming the key that is unknown, missing or of the
    /// wrong type, or [`JobError::UnknownOperationType`] when the `type` value
    /// names none of the four operations.
    pub fn read(value: &Value) -> Result<Self, JobError> {
        let object = value.as_object().ok_or(JobError::NotAnObject)?;
        check_key_set(object, &OPERATION_KEYS)?;
        Ok(Self {
            kind: OperationKind::read(object)?,
            object_id: field(object, "object_id")?,
            dataset_id: field(object, "dataset_id")?,
            testcase_codename: field(object, "testcase_codename")?,
            archive_sandbox: field(object, "archive_sandbox")?,
        })
    }
}

impl OperationKind {
    /// Reads the `type` key, which is what distinguishes the four operations.
    ///
    /// # Errors
    ///
    /// Returns [`JobError::UnknownOperationType`] for a string that names none
    /// of the four values [`crate::OPERATION_TYPES`] pins, and
    /// [`JobError::WrongValue`] naming the key when it is not a string at all.
    pub fn read(object: &Map<String, Value>) -> Result<Self, JobError> {
        let found = read_name(object, "type")?;
        match found.as_str() {
            "compile" => Ok(Self::Compilation),
            "evaluate" => Ok(Self::Evaluation),
            "compile_test" => Ok(Self::UserTestCompilation),
            "evaluate_test" => Ok(Self::UserTestEvaluation),
            _ => Err(JobError::UnknownOperationType { found }),
        }
    }
}
