//! The shape a compilation job has, and the path that builds it for a
//! submission.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use serde_json::Value;

use cms_proto::{DigestMap, Operation, OperationKind};

use super::{check_scope, BuildError, Dataset, Submission};

/// A job to compile one object, as `CompilationJob` holds it.
///
/// The object is a submission or a user test, and the two are compiled by
/// different constructors; the job itself cannot tell them apart, because
/// Python's does not either. The keys the worker fills in when it reports the
/// compilation — the shard, the sandboxes, the executables it produced and
/// whether the compilation succeeded — are not fields of a job that has not
/// been run.
#[derive(Debug, Clone, PartialEq)]
pub struct CompilationJob {
    /// The operation the job performs, which is what the result is filed under.
    pub operation: Operation,
    /// `datasets.task_type`, the name of the task type that judges it.
    pub task_type: String,
    /// `datasets.task_type_parameters`, opaque to everything but the task type.
    pub task_type_parameters: Value,
    /// The language the object was submitted under, absent when the task takes
    /// no language.
    pub language: Option<String>,
    /// Whether the sandbox is to be given more than one thread, which the
    /// object and its task decide rather than the dataset.
    pub multithreaded_sandbox: bool,
    /// `operation.archive_sandbox`, which the worker reads off the operation.
    pub archive_sandbox: bool,
    /// The files the object submitted, by name, as digests.
    pub files: DigestMap,
    /// The managers the job is given, which the two constructors do not build
    /// the same way.
    pub managers: DigestMap,
    /// A sentence naming what is being compiled and for what.
    pub info: String,
}

impl CompilationJob {
    /// Compiles a submission, `CompilationJob.from_submission`.
    ///
    /// The managers are the dataset's, verbatim: a submission carries none of
    /// its own, so the automatic managers a user test gains and the headers a
    /// user test is given are not gathered here, and the dataset's managers are
    /// neither renamed nor filtered.
    ///
    /// # Errors
    ///
    /// [`BuildError::ObjectMismatch`] and [`BuildError::DatasetMismatch`] when
    /// the operation names another object or dataset, and
    /// [`BuildError::UnexpectedOperation`] when it is not a compilation.
    pub fn from_submission(
        operation: &Operation,
        submission: &Submission,
        dataset: &Dataset,
    ) -> Result<Self, BuildError> {
        check_scope(operation, submission.id, dataset.id)?;
        if operation.kind != OperationKind::Compilation {
            return Err(BuildError::UnexpectedOperation {
                wanted: OperationKind::Compilation,
                found: operation.kind,
            });
        }
        Ok(Self {
            operation: operation.clone(),
            task_type: dataset.task_type.clone(),
            task_type_parameters: dataset.task_type_parameters.clone(),
            language: submission.language.clone(),
            multithreaded_sandbox: submission.multithreaded_sandbox,
            archive_sandbox: operation.archive_sandbox,
            files: submission.files.clone(),
            managers: dataset.managers.clone(),
            info: format!("compile submission {}", submission.id),
        })
    }
}
