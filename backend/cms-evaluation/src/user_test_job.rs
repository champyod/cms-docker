//! Builds the exact worker body of one user-test compilation or evaluation job
//! from the single [`UserTestInputs`] bundle a judging read produced.
//!
//! [`user_test_job`] is the whole of the translation: it parses the dataset's
//! raw `task_type_parameters` once, asks the named task type for its automatic
//! managers, reshapes the bundle into the [`Dataset`] and [`UserTest`] the
//! `cms-grading` constructors read, and dispatches on the operation's kind to
//! the one constructor that stands for it. The constructors keep their own
//! validation of the kind, the object id, the dataset id, the manager names and
//! the language lookup; this module does not repeat it. A submission kind is
//! refused before any constructor is reached.
//!
//! The four refusals in [`UserTestJobError`] stay distinct so a caller can tell
//! unparseable parameters, an unimplemented task type, a constructor's named
//! disagreement, and an operation this builder does not stand for apart.

use std::fmt;

use serde_json::Value;

use cms_db::UserTestInputs;
use cms_grading::job::{BuildError, CompilationJob, Dataset, EvaluationJob, UserTest};
use cms_grading::languages::{describe, is_multithreaded};
use cms_grading::tasktypes::{TaskError, TaskType};
use cms_proto::{Operation, OperationKind};

use crate::job::as_digest_map;

/// Why one user-test job body could not be built from a bundle.
#[derive(Debug)]
pub enum UserTestJobError {
    /// `datasets.task_type_parameters` was not a JSON value.
    MalformedDatasetParameters {
        /// The parse refusal from `serde_json`.
        source: serde_json::Error,
    },
    /// The dataset named a task type this worker does not implement, or one
    /// whose parameters the task type refused.
    UnknownTaskType {
        /// The task type's own named refusal.
        source: TaskError,
    },
    /// A job constructor refused the operation.
    Build {
        /// The constructor's own named refusal.
        source: BuildError,
    },
    /// The operation is neither a user-test compilation nor a user-test
    /// evaluation, so this builder has no constructor to hand it to.
    UnsupportedOperation {
        /// The kind the operation named.
        kind: OperationKind,
    },
}

impl fmt::Display for UserTestJobError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MalformedDatasetParameters { .. } => {
                write!(f, "dataset task_type_parameters is not valid JSON")
            }
            Self::UnknownTaskType { source } => write!(f, "{source}"),
            Self::Build { source } => write!(f, "{source}"),
            Self::UnsupportedOperation { kind } => write!(
                f,
                "operation kind {kind:?} is not a user test compilation or evaluation"
            ),
        }
    }
}

impl std::error::Error for UserTestJobError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::MalformedDatasetParameters { source } => Some(source),
            Self::UnknownTaskType { source } => Some(source),
            Self::Build { source } => Some(source),
            Self::UnsupportedOperation { .. } => None,
        }
    }
}

impl From<BuildError> for UserTestJobError {
    fn from(source: BuildError) -> Self {
        Self::Build { source }
    }
}

/// Reshapes the bundle's dataset into the value the constructors read.
fn build_dataset(
    inputs: &UserTestInputs,
    parameters: Value,
    auto_managers: Vec<String>,
) -> Dataset {
    Dataset {
        id: i64::from(inputs.dataset.id.0),
        task_type: inputs.dataset.task_type.clone(),
        task_type_parameters: parameters,
        managers: as_digest_map(&inputs.managers),
        auto_managers: Some(auto_managers),
        testcases: std::collections::BTreeMap::new(),
        time_limit: inputs.dataset.time_limit,
        memory_limit: inputs.dataset.memory_limit,
    }
}

/// Reshapes the bundle's user test into the value the constructors read.
fn build_user_test(inputs: &UserTestInputs) -> UserTest {
    let language_names: Vec<&str> = inputs.languages.iter().map(String::as_str).collect();
    let language = inputs.user_test.language.clone();
    let language_descriptor = language.as_deref().and_then(describe);
    UserTest {
        id: i64::from(inputs.user_test.id),
        language,
        language_descriptor,
        files: as_digest_map(&inputs.files),
        managers: as_digest_map(&inputs.user_test_managers),
        input: inputs.user_test.input.as_str().to_owned(),
        result_executables: as_digest_map(&inputs.executables),
        multithreaded_sandbox: is_multithreaded(&language_names),
    }
}

/// Builds the exact worker body of a user-test compilation or evaluation job.
///
/// The parameters are parsed once and shared by both shapes. The task type's
/// automatic managers are taken from the named type rather than inferred from
/// the dataset's whole manager set, which is the reference's distinction
/// between a user test and a submission. The contest's languages decide
/// `multithreaded_sandbox`, and the language descriptor is looked up only when
/// the test named a language.
///
/// # Errors
///
/// [`UserTestJobError::MalformedDatasetParameters`] when the parameters are not
/// JSON, [`UserTestJobError::UnknownTaskType`] when the task type or its
/// parameters are refused, [`UserTestJobError::Build`] when a constructor
/// refuses the operation's kind, object id, dataset id, manager or language,
/// and [`UserTestJobError::UnsupportedOperation`] for a submission kind.
pub fn user_test_job(
    operation: &Operation,
    inputs: &UserTestInputs,
) -> Result<Value, UserTestJobError> {
    let parameters: Value = serde_json::from_str(&inputs.dataset.task_type_parameters)
        .map_err(|source| UserTestJobError::MalformedDatasetParameters { source })?;
    let task_type = TaskType::of(&inputs.dataset.task_type, &parameters)
        .map_err(|source| UserTestJobError::UnknownTaskType { source })?;
    let dataset = build_dataset(inputs, parameters, task_type.auto_managers());
    let user_test = build_user_test(inputs);

    let body = match operation.kind {
        OperationKind::UserTestCompilation => {
            CompilationJob::from_user_test(operation, &user_test, &dataset)?.to_body()
        }
        OperationKind::UserTestEvaluation => {
            EvaluationJob::from_user_test(operation, &user_test, &dataset)?.to_body()
        }
        other => return Err(UserTestJobError::UnsupportedOperation { kind: other }),
    };
    Ok(Value::Object(body))
}
