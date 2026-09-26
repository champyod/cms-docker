//! The exact key sets the Python job payloads carry, one per job kind.
//!
//! `Job.export_to_dict` writes seventeen keys and each subclass adds its own on
//! top: `CompilationJob.export_to_dict` adds `compilation_success` and
//! `EvaluationJob.export_to_dict` adds eight, on top of the `type` and `plus`
//! both carry, so nineteen keys are common to the two and a compilation job is
//! twenty keys where an evaluation job is twenty-seven. `ESOperation.to_dict`
//! writes five, and it sits inside the job, so it has a key set of its own.
//!
//! A set is only worth writing out if something refuses a job that does not
//! match it, so the refusal lives here next to the sets: Python imports a job
//! with `cls(**data)`, which raises `TypeError` on a key the constructor does
//! not take and on one it needs and did not get. [`check_key_set`] is that
//! refusal, and it runs inside the decode of a single job, so a job carrying
//! the wrong keys costs only itself.

use std::collections::BTreeMap;

use serde::de::DeserializeOwned;
use serde_json::{Map, Value};

use super::refusal::JobError;

/// Names of files, managers and executables, keyed by name.
///
/// This is the shape `Job.export_to_dict` writes for `files`, `managers` and
/// `executables`, which it fills from `File.digest`, `Manager.digest` and
/// `Executable.digest`.
///
/// Ordered rather than hashed so two decoded jobs compare and print in the same
/// order whatever order the JSON object arrived in.
pub type DigestMap = BTreeMap<String, String>;

/// The `type` value `CompilationJob.export_to_dict` writes.
pub const COMPILATION_TYPE: &str = "compilation";

/// The `type` value `EvaluationJob.export_to_dict` writes.
pub const EVALUATION_TYPE: &str = "evaluation";

/// The five keys `ESOperation.to_dict` writes and `from_dict` reads back.
pub const OPERATION_KEYS: [&str; 5] = [
    "type",
    "object_id",
    "dataset_id",
    "testcase_codename",
    "archive_sandbox",
];

/// The four values `ESOperation.type_` takes, which are the operation's own
/// discriminator and are unrelated to the job's `type`.
pub const OPERATION_TYPES: [&str; 4] = ["compile", "evaluate", "compile_test", "evaluate_test"];

/// The three keys whose value is a [`DigestMap`].
pub const DIGEST_MAP_KEYS: [&str; 3] = ["files", "managers", "executables"];

/// The twenty keys `CompilationJob.export_to_dict` writes: the seventeen
/// `Job.export_to_dict` keys, then the `type` and `plus` it shares with the
/// evaluation shape and the one key only it has.
pub const COMPILATION_KEYS: [&str; 20] = [
    "operation",
    "task_type",
    "task_type_parameters",
    "language",
    "multithreaded_sandbox",
    "archive_sandbox",
    "shard",
    "keep_sandbox",
    "sandboxes",
    "sandbox_digests",
    "info",
    "success",
    "text",
    "admin_text",
    "files",
    "managers",
    "executables",
    "type",
    "compilation_success",
    "plus",
];

/// The twenty-seven keys `EvaluationJob.export_to_dict` writes: the same
/// nineteen, then the eight keys only it has.
pub const EVALUATION_KEYS: [&str; 27] = [
    "operation",
    "task_type",
    "task_type_parameters",
    "language",
    "multithreaded_sandbox",
    "archive_sandbox",
    "shard",
    "keep_sandbox",
    "sandboxes",
    "sandbox_digests",
    "info",
    "success",
    "text",
    "admin_text",
    "files",
    "managers",
    "executables",
    "type",
    "input",
    "output",
    "time_limit",
    "memory_limit",
    "outcome",
    "user_output",
    "plus",
    "only_execution",
    "get_output",
];

/// The eight `EVALUATION_KEYS` that report what the run measured.
///
/// Every one of them may be null on the wire, because the worker exports
/// whatever the task type set and a task type that did not run leaves the field
/// at its `None`.
pub const EVALUATION_EXECUTION_KEYS: [&str; 8] = [
    "input",
    "output",
    "time_limit",
    "memory_limit",
    "outcome",
    "user_output",
    "only_execution",
    "get_output",
];

/// Which of the two job shapes a job has, as its `type` key names it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum JobKind {
    /// The twenty-key `CompilationJob` shape.
    Compilation,
    /// The twenty-seven-key `EvaluationJob` shape.
    Evaluation,
}

impl JobKind {
    /// The `type` value this kind is written as.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Compilation => COMPILATION_TYPE,
            Self::Evaluation => EVALUATION_TYPE,
        }
    }

    /// Reads the `type` key, which is what `import_from_dict_with_type`
    /// dispatches on, refusing a value that names neither shape.
    ///
    /// # Errors
    ///
    /// Returns [`JobError::UnknownJobType`] for a string that is neither
    /// [`COMPILATION_TYPE`] nor [`EVALUATION_TYPE`], and
    /// [`JobError::WrongValue`] naming the key when it is not a string at all.
    pub fn read(object: &Map<String, Value>) -> Result<Self, JobError> {
        let found = read_name(object, "type")?;
        match found.as_str() {
            COMPILATION_TYPE => Ok(Self::Compilation),
            EVALUATION_TYPE => Ok(Self::Evaluation),
            _ => Err(JobError::UnknownJobType { found }),
        }
    }
}

/// The key set a job of this kind must carry.
///
/// # Errors
///
/// None. The set is a property of the kind, and a job that does not match it is
/// refused by `check_key_set`, which is where the sets are enforced.
#[must_use]
pub const fn key_set_for(kind: JobKind) -> &'static [&'static str] {
    match kind {
        JobKind::Compilation => &COMPILATION_KEYS,
        JobKind::Evaluation => &EVALUATION_KEYS,
    }
}

/// Refuses a JSON object whose keys are not exactly `key_set`.
///
/// Runs before any value is read, so a job carrying a key the Python side would
/// not have produced is named by that key rather than by whatever value happens
/// to sit under a field the Rust side expected.
///
/// # Errors
///
/// Returns [`JobError::UnknownKey`] for the first key the set does not list, and
/// [`JobError::MissingKey`] for the first key the set lists and the object
/// omits. Both name the key, so a log line says which one to look at.
pub fn check_key_set(
    object: &Map<String, Value>,
    key_set: &[&'static str],
) -> Result<(), JobError> {
    for name in object.keys() {
        if !key_set.contains(&name.as_str()) {
            return Err(JobError::UnknownKey { key: name.clone() });
        }
    }
    for key in key_set {
        if !object.contains_key(*key) {
            return Err(JobError::MissingKey { key });
        }
    }
    Ok(())
}

/// Reads one key of a known type out of an object.
///
/// # Errors
///
/// Returns [`JobError::MissingKey`] when the object has no such key, and
/// [`JobError::WrongValue`] naming the key when the value under it is not of
/// the type the job declares.
pub fn field<T: DeserializeOwned>(
    object: &Map<String, Value>,
    key: &'static str,
) -> Result<T, JobError> {
    let value = object.get(key).ok_or(JobError::MissingKey { key })?;
    T::deserialize(value).map_err(|source| JobError::WrongValue {
        key,
        detail: source.to_string(),
    })
}

/// Reads a discriminator key, whose value names a variant.
///
/// # Errors
///
/// Returns [`JobError::MissingKey`] when the object has no such key, and
/// [`JobError::WrongValue`] naming the key when its value is not a string.
pub fn read_name(object: &Map<String, Value>, key: &'static str) -> Result<String, JobError> {
    match object.get(key) {
        Some(Value::String(name)) => Ok(name.clone()),
        Some(_) => Err(JobError::WrongValue {
            key,
            detail: "expected a JSON string".to_owned(),
        }),
        None => Err(JobError::MissingKey { key }),
    }
}
