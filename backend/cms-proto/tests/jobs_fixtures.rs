//! The literals both job suites decode, and the call they are reported through.
//!
//! Each test target is a crate of its own, so this module is the one place the
//! Python exports are written down. The literals are what `Job.export_to_dict`
//! produces and the wrapper is what `action_finished` reports them through.

use cms_proto::{FinishedCall, IsolatedBatch, JobError, JobKind, Quarantine, Shard};
use serde_json::{json, Value};

/// A `Job.export_to_dict` output for a compilation job.
const COMPILATION_JOB: &str = r#"{
  "operation": {"type": "compile", "object_id": 42, "dataset_id": 7,
    "testcase_codename": null, "archive_sandbox": false},
  "task_type": "batch", "task_type_parameters": {"compilation": "grader"}, "language": "C++17",
  "multithreaded_sandbox": false, "archive_sandbox": false, "shard": 3, "keep_sandbox": false,
  "sandboxes": [], "sandbox_digests": {}, "info": "Compilation", "success": true, "text": "ok",
  "admin_text": "", "files": {"foo.cpp": "1a2b3c4d5e6f7890"}, "managers": {}, "executables": {},
  "type": "compilation", "compilation_success": true, "plus": {}}"#;

/// A `Job.export_to_dict` output for an evaluation job.
const EVALUATION_JOB: &str = r#"{
  "operation": {"type": "evaluate", "object_id": 42, "dataset_id": 7,
    "testcase_codename": "001", "archive_sandbox": false},
  "task_type": "batch", "task_type_parameters": {"evaluation": "grader"}, "language": "C++17",
  "multithreaded_sandbox": false, "archive_sandbox": false, "shard": 3, "keep_sandbox": false,
  "sandboxes": [], "sandbox_digests": {}, "info": "Evaluation", "success": true, "text": "ok",
  "admin_text": "", "files": {}, "managers": {}, "executables": {}, "type": "evaluation",
  "input": null, "output": "4\n", "time_limit": 2.0, "memory_limit": 262144, "outcome": "correct",
  "user_output": "", "plus": {}, "only_execution": false, "get_output": false}"#;

/// The job of this kind as the Python side writes it.
///
/// # Panics
///
/// On a literal this file owns that stopped being valid JSON, which would mean
/// the fixture and the Python export no longer agree.
#[must_use]
pub fn job(kind: JobKind) -> Value {
    let literal = match kind {
        JobKind::Compilation => COMPILATION_JOB,
        JobKind::Evaluation => EVALUATION_JOB,
    };
    serde_json::from_str(literal).expect("the python literal must be valid JSON")
}

/// The outcome of a call reporting these jobs from this shard, this error.
///
/// # Errors
///
/// Whatever `FinishedCall::isolate` reports for a batch carrying these jobs, so
/// a test can name the refusal it expects.
pub fn reported(
    jobs: &[Value],
    shard: i64,
    error: Option<&str>,
) -> Result<IsolatedBatch, JobError> {
    let call = FinishedCall {
        data: json!({ "jobs": jobs }),
        shard: Shard::new(shard),
        error: error.map(str::to_owned),
    };
    call.isolate()
}

/// The one job of these that was refused, with its reason and its requeue.
///
/// # Panics
///
/// On a batch that quarantined anything other than exactly one job, which would
/// mean the fixture stopped isolating the one refusal it is written for.
#[must_use]
pub fn quarantined(jobs: &[Value]) -> Quarantine {
    let batch = reported(jobs, 3, None).expect("must isolate");
    let mut refused = batch.quarantined();
    assert_eq!(refused.len(), 1, "exactly one job must be refused");
    refused.remove(0).clone()
}
