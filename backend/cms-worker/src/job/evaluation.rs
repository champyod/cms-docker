//! The shape an evaluation job has, and the path that builds it for a
//! submission.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use serde_json::Value;

use cms_proto::{DigestMap, Operation, OperationKind};

use super::{check_scope, BuildError, Dataset, Submission, Testcase};

/// A job to evaluate one object on one testcase, as `EvaluationJob` holds it.
///
/// On top of what a compilation job carries this names the input the run is
/// given and, for a submission, the output it is compared against. The keys the
/// worker fills in when it reports the run — the shard, the sandboxes, the
/// outcome, the user output and the time and memory it was charged — are not
/// fields of a job that has not been run.
#[derive(Debug, Clone, PartialEq)]
pub struct EvaluationJob {
    /// The operation the job performs, which is what the result is filed under
    /// and which names the testcase.
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
    /// The executables the object's result for this dataset holds, which is
    /// what the run is given to execute.
    pub executables: DigestMap,
    /// The digest of the input file, which a testcase names for a submission and
    /// a user test carries itself.
    pub input: String,
    /// The digest of the output file, which only a submission's testcase names.
    pub output: Option<String>,
    /// `datasets.time_limit` in seconds, absent when the dataset sets none.
    pub time_limit: Option<f64>,
    /// `datasets.memory_limit` in bytes, absent when the dataset sets none.
    pub memory_limit: Option<i64>,
    /// Whether the run is only executed rather than compared against the
    /// testcase's output: `false` for a submission, which is scored, `true` for
    /// a user test, which is run to see what it prints. Every evaluation writes
    /// the key, so a job states the flag rather than leaving it out.
    pub only_execution: Option<bool>,
    /// Whether the output of the run is to be fetched: `true` for a user test,
    /// `false` for a submission, for the same reason.
    pub get_output: Option<bool>,
    /// A sentence naming what is being evaluated and against what.
    pub info: String,
}

impl EvaluationJob {
    /// Evaluates a submission on the testcase its operation names,
    /// `EvaluationJob.from_submission`.
    ///
    /// The managers are the dataset's, verbatim, as they are for a submission
    /// compilation. The executables are the ones the submission's result for
    /// this dataset already holds, and the testcase the operation names is
    /// looked up in the dataset for its input and its output.
    ///
    /// Both output flags are `false`, a value this path states rather than one
    /// it leaves out. `EvaluationJob.__init__` defaults `only_execution` and
    /// `get_output` to `False`, `from_submission` names neither, and
    /// `export_to_dict` writes both whatever they hold (`Job.py:549-550`,
    /// `Job.py:599-600`, `Job.py:635-650`). Nothing downstream separates that
    /// from an absent value: the pinned evaluation set lists both keys
    /// (`keys.rs:110-111`) and reads each as an `Option<bool>`
    /// (`isolation.rs:241-242`), and a task type tests the truth of one
    /// (`Batch.py:353`), so the wire form is decided here.
    ///
    /// # Errors
    ///
    /// [`BuildError::ObjectMismatch`] and [`BuildError::DatasetMismatch`] when
    /// the operation names another object or dataset,
    /// [`BuildError::UnexpectedOperation`] when it is not an evaluation, and
    /// [`BuildError::UnknownTestcase`] when the dataset holds no testcase of
    /// that codename.
    pub fn from_submission(
        operation: &Operation,
        submission: &Submission,
        dataset: &Dataset,
    ) -> Result<Self, BuildError> {
        check_scope(operation, submission.id, dataset.id)?;
        if operation.kind != OperationKind::Evaluation {
            return Err(BuildError::UnexpectedOperation {
                wanted: OperationKind::Evaluation,
                found: operation.kind,
            });
        }
        let testcase = require_testcase(operation, dataset)?;
        Ok(Self {
            operation: operation.clone(),
            task_type: dataset.task_type.clone(),
            task_type_parameters: dataset.task_type_parameters.clone(),
            language: submission.language.clone(),
            multithreaded_sandbox: submission.multithreaded_sandbox,
            archive_sandbox: operation.archive_sandbox,
            files: submission.files.clone(),
            managers: dataset.managers.clone(),
            executables: submission.result_executables.clone(),
            input: testcase.input.clone(),
            output: Some(testcase.output.clone()),
            time_limit: dataset.time_limit,
            memory_limit: dataset.memory_limit,
            only_execution: Some(false),
            get_output: Some(false),
            info: submission_info(submission, testcase),
        })
    }
}

/// The testcase a submission evaluation is run on: the one the operation names,
/// taken out of the dataset.
///
/// An operation that names none and a codename the dataset holds no testcase
/// for are one refusal, the codename filled in or left out.
fn require_testcase<'a>(
    operation: &Operation,
    dataset: &'a Dataset,
) -> Result<&'a Testcase, BuildError> {
    let Some(codename) = operation.testcase_codename.as_deref() else {
        return Err(BuildError::UnknownTestcase { codename: None });
    };
    dataset
        .testcases
        .get(codename)
        .ok_or_else(|| BuildError::UnknownTestcase {
            codename: Some(codename.to_owned()),
        })
}

/// The sentence a submission evaluation carries, naming the submission and the
/// testcase it is run on.
fn submission_info(submission: &Submission, testcase: &Testcase) -> String {
    format!(
        "evaluate submission {} on testcase {}",
        submission.id, testcase.codename
    )
}
