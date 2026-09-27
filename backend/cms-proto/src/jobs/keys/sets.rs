//! The key names, written out exactly as the Python side writes them.
//!
//! Nothing here decides anything: these are the literals, and the refusal that
//! compares a job against them lives in [`super::read`].

use std::collections::BTreeMap;

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
