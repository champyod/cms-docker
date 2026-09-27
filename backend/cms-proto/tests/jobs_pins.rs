//! The key sets a job, its operation and the batch around it must carry.
//!
//! The literals are what the Python side writes: `Job.export_to_dict`, the keys
//! each subclass adds on top, and the wrapper `action_finished` reports them
//! through. The pin tests compare them against the constants, so a constant
//! edited without the Python side being edited fails here rather than in
//! production.

mod jobs_fixtures;

use cms_proto::{
    key_set_for, FinishedCall, JobError, JobKind, Shard, COMPILATION_KEYS, DIGEST_MAP_KEYS,
    EVALUATION_EXECUTION_KEYS, EVALUATION_KEYS, OPERATION_KEYS,
};
use jobs_fixtures::{job, quarantined, reported};
use serde_json::{json, Value};

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
