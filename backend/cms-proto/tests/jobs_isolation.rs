//! The key sets a job must carry, and what isolating one batch does with a job
//! that does not.
//!
//! The two literals are what the Python side writes: `Job.export_to_dict` and
//! the keys each subclass adds on top. The pin tests compare them against the
//! constants, so a constant edited without the Python side being edited fails
//! here rather than in production.

use cms_proto::{
    key_set_for, DigestMap, EvaluationOutcome, FinishedCall, IsolatedBatch, JobError, JobKind,
    KindExtras, OperationKind, Quarantine, Requeue, Shard, COMPILATION_KEYS, DIGEST_MAP_KEYS,
    EVALUATION_EXECUTION_KEYS, EVALUATION_KEYS, OPERATION_KEYS,
};
use serde_json::{json, Value};

const COMPILATION_JOB: &str = r#"{
  "operation": {"type": "compile", "object_id": 42, "dataset_id": 7,
    "testcase_codename": null, "archive_sandbox": false},
  "task_type": "batch", "task_type_parameters": {"compilation": "grader"}, "language": "C++17",
  "multithreaded_sandbox": false, "archive_sandbox": false, "shard": 3, "keep_sandbox": false,
  "sandboxes": [], "sandbox_digests": {}, "info": "Compilation", "success": true, "text": "ok",
  "admin_text": "", "files": {"foo.cpp": "1a2b3c4d5e6f7890"}, "managers": {}, "executables": {},
  "type": "compilation", "compilation_success": true, "plus": {}}"#;

const EVALUATION_JOB: &str = r#"{
  "operation": {"type": "evaluate", "object_id": 42, "dataset_id": 7,
    "testcase_codename": "001", "archive_sandbox": false},
  "task_type": "batch", "task_type_parameters": {"evaluation": "grader"}, "language": "C++17",
  "multithreaded_sandbox": false, "archive_sandbox": false, "shard": 3, "keep_sandbox": false,
  "sandboxes": [], "sandbox_digests": {}, "info": "Evaluation", "success": true, "text": "ok",
  "admin_text": "", "files": {}, "managers": {}, "executables": {}, "type": "evaluation",
  "input": null, "output": "4\n", "time_limit": 2.0, "memory_limit": 262144, "outcome": "correct",
  "user_output": "", "plus": {}, "only_execution": false, "get_output": false}"#;

/// A memory limit above 2^53 and a whole number of mebibytes, so it is a limit
/// the dataset accepts and a float could not hold: one bit past the mantissa.
const EXACT_MEMORY_LIMIT: i64 = 9_007_200_303_259_568;

fn job(kind: JobKind) -> Value {
    let literal = match kind {
        JobKind::Compilation => COMPILATION_JOB,
        JobKind::Evaluation => EVALUATION_JOB,
    };
    serde_json::from_str(literal).expect("the python literal must be valid JSON")
}

/// A compilation job with `key` set to `value`.
fn with(key: &str, value: Value) -> Value {
    let mut job = job(JobKind::Compilation);
    job.as_object_mut()
        .expect("an object")
        .insert(key.to_owned(), value);
    job
}

/// A compilation job without `key`, which no export of the Python side produces
/// because it always fills every key it declares.
fn without(key: &str) -> Value {
    let mut job = job(JobKind::Compilation);
    job.as_object_mut().expect("an object").remove(key);
    job
}

fn keys_of(value: &Value) -> Vec<&str> {
    let object = value.as_object().expect("a job must be a JSON object");
    let mut keys: Vec<&str> = object.keys().map(String::as_str).collect();
    keys.sort_unstable();
    keys
}

fn sorted<'a>(keys: &[&'a str]) -> Vec<&'a str> {
    let mut keys = keys.to_vec();
    keys.sort_unstable();
    keys
}

fn shared_keys() -> Vec<&'static str> {
    COMPILATION_KEYS
        .iter()
        .filter(|k| EVALUATION_KEYS.contains(k))
        .copied()
        .collect()
}

/// The outcome of a call reporting these jobs from this shard, this error.
fn reported(jobs: Vec<Value>, shard: i64, error: Option<&str>) -> Result<IsolatedBatch, JobError> {
    let call = FinishedCall {
        data: json!({ "jobs": jobs }),
        shard: Shard::new(shard),
        error: error.map(str::to_owned),
    };
    call.isolate()
}

/// The one job of these that was refused, with its reason and its requeue.
fn quarantined(jobs: Vec<Value>) -> Quarantine {
    let batch = reported(jobs, 3, None).expect("must isolate");
    let mut refused = batch.quarantined();
    assert_eq!(refused.len(), 1, "exactly one job must be refused");
    refused.remove(0).clone()
}

/// The reason the one compilation job of these is refused for.
fn refused(job: Value) -> JobError {
    quarantined(vec![job]).reason
}

/// The evaluation outcome of the one job of these carrying `key` set to
/// `value`, or the reason that one job was refused for.
fn evaluated(key: &str, value: Value) -> Result<EvaluationOutcome, JobError> {
    let mut job = job(JobKind::Evaluation);
    job.as_object_mut()
        .expect("an object")
        .insert(key.to_owned(), value);
    let batch = reported(vec![job], 3, None).expect("one job never fails the batch");
    if let Some(quarantine) = batch.quarantined().first() {
        return Err(quarantine.reason.clone());
    }
    let extras = &batch.committed()[0].extras;
    let KindExtras::Evaluation(outcome) = extras else {
        panic!("an evaluation job carries the evaluation fields");
    };
    Ok(outcome.clone())
}

#[test]
fn the_key_sets_are_exactly_the_ones_the_python_exports_write() {
    for (kind, pinned) in [
        (JobKind::Compilation, &COMPILATION_KEYS[..]),
        (JobKind::Evaluation, &EVALUATION_KEYS[..]),
    ] {
        assert_eq!(keys_of(&job(kind)), sorted(pinned));
        assert_eq!(key_set_for(kind), pinned);
        assert_eq!(
            sorted(pinned).len(),
            pinned.len(),
            "a repeated key is a pin that lies"
        );
    }
    let operation = job(JobKind::Evaluation)["operation"].clone();
    assert_eq!(keys_of(&operation), sorted(&OPERATION_KEYS));
    let sizes = [
        COMPILATION_KEYS.len(),
        EVALUATION_KEYS.len(),
        OPERATION_KEYS.len(),
    ];
    assert_eq!(sizes, [20, 27, 5]);
}

#[test]
fn the_two_job_sets_differ_only_in_what_each_subclass_adds() {
    let shared = shared_keys();
    let only: Vec<&str> = COMPILATION_KEYS
        .iter()
        .filter(|k| !shared.contains(k))
        .copied()
        .collect();
    let sizes = [shared.len(), only.len(), EVALUATION_EXECUTION_KEYS.len()];
    let mut nullable = job(JobKind::Evaluation);
    nullable["outcome"] = Value::Null;

    assert_eq!(
        (sizes, only.as_slice()),
        ([19, 1, 8], ["compilation_success"].as_slice())
    );
    assert_eq!(shared.len() + only.len(), COMPILATION_KEYS.len());
    assert_eq!(
        shared.len() + EVALUATION_EXECUTION_KEYS.len(),
        EVALUATION_KEYS.len()
    );
    assert!(DIGEST_MAP_KEYS.iter().all(|key| shared.contains(key)));
    assert!(EVALUATION_EXECUTION_KEYS
        .iter()
        .all(|k| !COMPILATION_KEYS.contains(k)));
    assert_eq!(
        reported(vec![nullable], 3, None)
            .expect("null must decode")
            .committed()
            .len(),
        1
    );
}

#[test]
fn the_two_levels_of_nesting_carry_the_group_beside_the_shard() {
    let mut wrapper = json!({
        "data": { "jobs": [job(JobKind::Compilation), job(JobKind::Evaluation)] },
        "shard": 3, "error": null,
    });
    let call: FinishedCall = serde_json::from_value(wrapper.clone()).expect("must decode");
    let batch = call.isolate().expect("two good jobs must isolate");

    assert_eq!(call.shard, Shard::new(3));
    assert_eq!(batch.committed().len(), 2);
    assert!(batch.quarantined().is_empty());
    wrapper["prize"] = json!(1);
    assert!(
        serde_json::from_value::<FinishedCall>(wrapper).is_err(),
        "not a python key"
    );
}

#[test]
fn a_decoded_job_carries_what_the_receiving_service_files() {
    let jobs = vec![job(JobKind::Evaluation), job(JobKind::Compilation)];
    let batch = reported(jobs, 3, None).expect("two good jobs must decode");
    let evaluation = batch.committed().remove(0).clone();
    let compilation = batch.committed().remove(1).clone();
    let Some(KindExtras::Evaluation(outcome)) = Some(&evaluation.extras) else {
        panic!("an evaluation job must carry the evaluation fields");
    };

    assert_eq!(outcome.outcome.as_deref(), Some("correct"));
    assert_eq!(outcome.time_limit, Some(2.0));
    assert_eq!(outcome.memory_limit, Some(262_144));
    assert_eq!(outcome.input.as_deref(), None);
    assert_eq!(outcome.get_output, Some(false));
    assert_eq!(
        [evaluation.success, compilation.success],
        [Some(true), Some(true)]
    );
    assert_eq!(
        [evaluation.shard, compilation.shard],
        [Shard::new(3), Shard::new(3)]
    );
    assert_eq!(compilation.files["foo.cpp"], "1a2b3c4d5e6f7890");
    assert_eq!(compilation.managers, DigestMap::new());
    let extra = KindExtras::Compilation {
        compilation_success: Some(true),
    };
    assert_eq!(compilation.extras, extra);
    let operations = [&evaluation.operation, &compilation.operation];
    let kinds = [OperationKind::Evaluation, OperationKind::Compilation];
    for (operation, kind) in operations.iter().zip(kinds) {
        let operation = operation.as_ref().expect("an operation");
        assert_eq!((operation.kind, operation.object_id), (kind, 42));
    }
}

#[test]
fn one_malformed_job_leaves_the_jobs_beside_it_committable() {
    let unknown = with("retries", json!(3));
    let duplicate = job(JobKind::Compilation);
    let jobs = vec![
        job(JobKind::Evaluation),
        unknown,
        duplicate.clone(),
        duplicate,
    ];
    let batch = reported(jobs, 3, None).expect("a malformed job must not fail the batch");
    let empty = reported(Vec::new(), 3, None).expect("an empty batch must isolate");
    let counts = (batch.committed().len(), batch.quarantined().len());
    let all = batch.quarantined();
    let repeated = all
        .iter()
        .find(|quarantine| quarantine.reason == JobError::DuplicateOperation)
        .expect("the repeat of an operation is refused");

    assert_eq!(
        counts,
        (2, 2),
        "the two good jobs survive and the two bad ones do not"
    );
    assert_eq!(repeated.requeue, Requeue::AlreadyReturned);
    assert!(empty.committed().is_empty() && empty.quarantined().is_empty());
}

#[test]
fn every_refusal_names_the_key_or_the_value_it_found() {
    let lost = quarantined(vec![without("info")]);
    let extra = refused(with("retries", json!(3)));
    let unknown = refused(with("type", json!("user_test")));
    let wrong_shard = refused(with("shard", json!("three")));
    let wrong_digest = refused(with("files", json!({"foo.cpp": 7})));

    assert_eq!(lost.reason, JobError::MissingKey { key: "info" });
    assert_eq!((lost.requeue, lost.index), (Requeue::Required, 0));
    assert_eq!(
        lost.operation.map(|op| op.object_id),
        Some(42),
        "the operation must survive"
    );
    assert_eq!(
        extra,
        JobError::UnknownKey {
            key: "retries".to_owned()
        }
    );
    assert_eq!(
        unknown,
        JobError::UnknownJobType {
            found: "user_test".to_owned()
        }
    );
    assert!(matches!(
        wrong_shard,
        JobError::WrongValue { key: "shard", .. }
    ));
    assert!(matches!(
        wrong_digest,
        JobError::WrongValue { key: "files", .. }
    ));
}

#[test]
fn a_nested_operation_and_a_foreign_shard_are_refused_where_they_sit() {
    let mut six_keyed = job(JobKind::Evaluation);
    let operation = six_keyed["operation"]
        .as_object_mut()
        .expect("an operation");
    operation.insert("multiplicity".to_owned(), json!(3));
    let six = quarantined(vec![six_keyed]);
    let foreign = reported(vec![job(JobKind::Compilation)], 4, None).expect("must isolate");

    assert_eq!(
        six.reason,
        JobError::UnknownKey {
            key: "multiplicity".to_owned()
        }
    );
    assert_eq!(
        six.operation, None,
        "an unread operation cannot be re-enqueued"
    );
    let mut refused = foreign.quarantined();
    let both = JobError::ShardMismatch {
        job: Shard::new(3),
        call: Shard::new(4),
    };
    assert_eq!(refused.remove(0).reason, both);
}

#[test]
fn the_two_whole_batch_failures_are_not_a_single_job() {
    let died = reported(vec![job(JobKind::Compilation)], 3, Some("died"));
    let not_a_group = json!({ "data": { "results": [] }, "shard": 3, "error": null });
    let not_a_group: Result<IsolatedBatch, JobError> =
        serde_json::from_value::<FinishedCall>(not_a_group)
            .expect("wrapper")
            .isolate();

    let is_death = matches!(died, Err(JobError::WorkerFailed { ref detail }) if detail == "died");
    assert!(
        is_death,
        "a reported failure loses the batch before any job is read"
    );
    assert!(matches!(not_a_group, Err(JobError::MalformedBatch { .. })));
}

#[test]
fn a_memory_limit_is_the_integer_the_python_side_declares() {
    let exact = evaluated("memory_limit", json!(EXACT_MEMORY_LIMIT));
    let refused = evaluated("memory_limit", json!(262_144.0));
    let none = evaluated("memory_limit", Value::Null).expect("null must decode");

    assert_eq!(none.memory_limit, None);
    assert_eq!(
        exact.expect("an integer must decode").memory_limit,
        Some(EXACT_MEMORY_LIMIT),
        "a float field would round this last bit away"
    );
    assert!(
        matches!(refused, Err(JobError::WrongValue { key, .. }) if key == "memory_limit"),
        "a float is not the form the constructor declares"
    );
}

#[test]
fn a_null_sandbox_list_is_the_empty_list_the_python_side_normalizes_to() {
    let mut none = job(JobKind::Compilation);
    none["sandboxes"] = Value::Null;
    let mut two = job(JobKind::Evaluation);
    two["sandboxes"] = json!(["/sandbox/0", "/sandbox/1"]);

    let batch = reported(vec![none, two], 3, None).expect("null must not fail a job");
    let lists: Vec<Vec<String>> = batch
        .committed()
        .iter()
        .map(|job| job.sandboxes.clone())
        .collect();

    assert!(batch.quarantined().is_empty(), "a null names no sandbox");
    assert_eq!(
        lists,
        vec![
            Vec::new(),
            vec!["/sandbox/0".to_owned(), "/sandbox/1".to_owned()]
        ],
        "normalizing null must not flatten the paths a job does name"
    );
}
