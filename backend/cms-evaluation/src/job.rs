//! Builds the exact worker body of one submission compilation or evaluation job
//! from the single [`SubmissionInputs`] bundle a judging read produced.
//!
//! [`submission_job`] is the whole of the translation: it parses the dataset's
//! raw `task_type_parameters` once, reshapes the bundle into the [`Dataset`] and
//! [`Submission`] the `cms-grading` constructors read, and dispatches on the
//! operation's kind to the one constructor that stands for it. The constructor's
//! own validation of the kind, the object id and the dataset id is left to it;
//! this module does not repeat it. A user-test kind is refused before any
//! constructor is reached.
//!
//! The three refusals in [`SubmissionJobError`] stay distinct so a caller can
//! tell unparseable parameters, a constructor's named disagreement, and an
//! operation this builder does not stand for apart.

use std::fmt;

use serde_json::Value;

use cms_db::{FileDigest, SubmissionInputs, TestcaseRecord};
use cms_grading::job::{BuildError, CompilationJob, Dataset, EvaluationJob, Submission, Testcase};
use cms_grading::languages::{describe, is_multithreaded};
use cms_proto::{DigestMap, Operation, OperationKind};

/// Why one submission job body could not be built from a bundle.
///
/// The build refusal is transparent: the constructor's own named disagreement
/// reaches the caller unchanged rather than being reworded here.
#[derive(Debug)]
pub enum SubmissionJobError {
    /// `datasets.task_type_parameters` was not a JSON value.
    MalformedDatasetParameters {
        /// The parse refusal from `serde_json`.
        source: serde_json::Error,
    },
    /// A job constructor refused the operation.
    Build {
        /// The constructor's own named refusal.
        source: BuildError,
    },
    /// The operation is neither a submission compilation nor a submission
    /// evaluation, so this builder has no constructor to hand it to.
    UnsupportedOperation {
        /// The kind the operation named.
        kind: OperationKind,
    },
}

impl fmt::Display for SubmissionJobError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MalformedDatasetParameters { .. } => {
                write!(f, "dataset task_type_parameters is not valid JSON")
            }
            Self::Build { source } => write!(f, "{source}"),
            Self::UnsupportedOperation { kind } => write!(
                f,
                "operation kind {kind:?} is not a submission compilation or evaluation"
            ),
        }
    }
}

impl std::error::Error for SubmissionJobError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::MalformedDatasetParameters { source } => Some(source),
            Self::Build { source } => Some(source),
            Self::UnsupportedOperation { .. } => None,
        }
    }
}

impl From<BuildError> for SubmissionJobError {
    fn from(source: BuildError) -> Self {
        Self::Build { source }
    }
}

/// Turns a bundle's named [`FileDigest`]s into the string digests a job carries.
///
/// A [`DigestMap`] is a [`std::collections::BTreeMap`], so collecting into one
/// gives the deterministic filename order the worker body is pinned to.
pub(crate) fn as_digest_map(files: &std::collections::BTreeMap<String, FileDigest>) -> DigestMap {
    files
        .iter()
        .map(|(name, digest)| (name.clone(), digest.as_str().to_owned()))
        .collect()
}

/// Indexes the dataset's testcases by the codename an evaluation addresses them
/// by, carrying each one's input and output digests as strings.
fn as_testcases(records: &[TestcaseRecord]) -> std::collections::BTreeMap<String, Testcase> {
    records
        .iter()
        .map(|record| {
            (
                record.codename.clone(),
                Testcase {
                    codename: record.codename.clone(),
                    input: record.input.as_str().to_owned(),
                    output: record.output.as_str().to_owned(),
                },
            )
        })
        .collect()
}

/// Builds the exact worker body of a submission compilation or evaluation job.
///
/// The parameters are parsed once and shared by both shapes. For a submission
/// `auto_managers` is `None`, so the constructor takes the dataset's managers
/// verbatim. The contest's languages decide `multithreaded_sandbox`, and the
/// language descriptor is looked up only when the submission named a language.
///
/// # Errors
///
/// [`SubmissionJobError::MalformedDatasetParameters`] when the parameters are
/// not JSON, [`SubmissionJobError::Build`] when a constructor refuses the
/// operation's kind, object id or dataset id, and
/// [`SubmissionJobError::UnsupportedOperation`] for a user-test kind.
pub fn submission_job(
    operation: &Operation,
    inputs: &SubmissionInputs,
) -> Result<Value, SubmissionJobError> {
    let task_type_parameters: Value = serde_json::from_str(&inputs.dataset.task_type_parameters)
        .map_err(|source| SubmissionJobError::MalformedDatasetParameters { source })?;

    let language_names: Vec<&str> = inputs.languages.iter().map(String::as_str).collect();
    let language = inputs.submission.record.language.clone();
    let language_descriptor = language.as_deref().and_then(describe);

    let dataset = Dataset {
        id: i64::from(inputs.dataset.id.0),
        task_type: inputs.dataset.task_type.clone(),
        task_type_parameters,
        managers: as_digest_map(&inputs.managers),
        auto_managers: None,
        testcases: as_testcases(&inputs.testcases),
        time_limit: inputs.dataset.time_limit,
        memory_limit: inputs.dataset.memory_limit,
    };
    let submission = Submission {
        id: i64::from(inputs.submission.record.id.0),
        language,
        language_descriptor,
        files: as_digest_map(&inputs.files),
        result_executables: as_digest_map(&inputs.executables),
        multithreaded_sandbox: is_multithreaded(&language_names),
    };

    let body = match operation.kind {
        OperationKind::Compilation => {
            CompilationJob::from_submission(operation, &submission, &dataset)?.to_body()
        }
        OperationKind::Evaluation => {
            EvaluationJob::from_submission(operation, &submission, &dataset)?.to_body()
        }
        other => return Err(SubmissionJobError::UnsupportedOperation { kind: other }),
    };
    Ok(Value::Object(body))
}
