//! What isolating a finished batch does with each job that does not carry the
//! keys, the values or the shard of its own kind.
//!
//! The key sets those jobs are checked against are pinned against the Python
//! exports in `jobs_pins`, which reads the same literals from `jobs_fixtures`.

mod jobs_fixtures;

use cms_proto::{
    DigestMap, EvaluationOutcome, FinishedCall, IsolatedBatch, JobError, JobKind, KindExtras,
    OperationKind, Requeue, Shard,
};
use jobs_fixtures::{job, quarantined, reported};
use serde_json::{json, Value};

/// `8_796_093_022_207` MiB: a whole number of mebibytes the dataset admits, and
/// the largest an `i64` limit carries. It needs 63 bits, so it arrives whole only
/// if the field is as wide as the `int` the constructor declares over its
/// `BigInteger` column.
const EXACT_MEMORY_LIMIT: i64 = 9_223_372_036_853_727_232;

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

/// The reason the one compilation job of these is refused for.
fn refused(job: Value) -> JobError {
    quarantined(&[job]).reason
}

/// The evaluation outcome of the one job of these carrying `key` set to
/// `value`, or the reason that one job was refused for.
fn evaluated(key: &str, value: Value) -> Result<EvaluationOutcome, JobError> {
    let mut job = job(JobKind::Evaluation);
    job.as_object_mut()
        .expect("an object")
        .insert(key.to_owned(), value);
    let batch = reported(&[job], 3, None).expect("one job never fails the batch");
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
fn a_decoded_job_carries_what_the_receiving_service_files() {
    let jobs = vec![job(JobKind::Evaluation), job(JobKind::Compilation)];
    let batch = reported(&jobs, 3, None).expect("two good jobs must decode");
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
    let batch = reported(&jobs, 3, None).expect("a malformed job must not fail the batch");
    let empty = reported(&[], 3, None).expect("an empty batch must isolate");
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
    let lost = quarantined(&[without("info")]);
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
fn the_two_whole_batch_failures_are_not_a_single_job() {
    let died = reported(&[job(JobKind::Compilation)], 3, Some("died"));
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
        "the declared int must arrive whole, as the BigInteger column holds it"
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

    let batch = reported(&[none, two], 3, None).expect("null must not fail a job");
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
