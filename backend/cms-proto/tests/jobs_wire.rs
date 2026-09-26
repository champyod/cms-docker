//! Wire-shape tests for the payloads a service reads from and writes to RPC.
//!
//! The literals below are the dictionaries the Python side builds:
//! `JobGroup.export_to_dict` for a worker's batch of results, and
//! `PriorityQueue.get_status` for the entries `queue_status` returns. A
//! mismatch in a key name or in a value type is a protocol break, so these
//! tests decode the literals, encode them back, and pin the key names.

use cms_proto::{JobGroup, QueueEntryDto, PRIORITY_EXTRA_HIGH, PRIORITY_MEDIUM};
use serde_json::Value;

/// A `JobGroup.export_to_dict` output holding one compilation job and one
/// evaluation job, the two shapes a worker can report.
const PYTHON_JOB_GROUP: &str = r#"{
    "jobs": [
        {
            "operation": {
                "type": "compile",
                "object_id": 42,
                "dataset_id": 7,
                "testcase_codename": null,
                "archive_sandbox": false
            },
            "task_type": "batch",
            "task_type_parameters": {"compilation": "grader", "evaluation": "grader"},
            "language": "C++17",
            "multithreaded_sandbox": false,
            "archive_sandbox": false,
            "shard": 0,
            "keep_sandbox": false,
            "sandboxes": [],
            "sandbox_digests": {},
            "info": "Compilation for submission 42 on dataset 7",
            "success": true,
            "text": "Evaluated successfully",
            "admin_text": "",
            "files": {"foo.cpp": "1a2b3c4d5e6f7890"},
            "managers": {},
            "executables": {},
            "type": "compilation",
            "compilation_success": true,
            "plus": {}
        },
        {
            "operation": {
                "type": "evaluate",
                "object_id": 42,
                "dataset_id": 7,
                "testcase_codename": "001",
                "archive_sandbox": false
            },
            "task_type": "batch",
            "task_type_parameters": {"compilation": "grader", "evaluation": "grader"},
            "language": "C++17",
            "multithreaded_sandbox": false,
            "archive_sandbox": false,
            "shard": 0,
            "keep_sandbox": false,
            "sandboxes": [],
            "sandbox_digests": {},
            "info": "Evaluation for submission 42 on dataset 7",
            "success": true,
            "text": "Output is correct",
            "admin_text": "",
            "files": {},
            "managers": {},
            "executables": {},
            "type": "evaluation",
            "input": null,
            "output": "4\n",
            "time_limit": 2.0,
            "memory_limit": 262144.0,
            "outcome": "correct",
            "user_output": "",
            "plus": {},
            "only_execution": false,
            "get_output": false
        }
    ]
}"#;

/// A `queue_status` reply: the list `EvaluationService.queue_status` returns,
/// one entry per group of operations waiting in the queue.
const PYTHON_QUEUE_STATUS: &str = r#"[
    {
        "item": {
            "type": "evaluate",
            "object_id": 42,
            "dataset_id": 7,
            "archive_sandbox": false,
            "multiplicity": 3
        },
        "priority": 2,
        "timestamp": 1700000000.5
    },
    {
        "item": {
            "type": "compile",
            "object_id": 43,
            "dataset_id": 7,
            "archive_sandbox": false,
            "multiplicity": 1
        },
        "priority": 0,
        "timestamp": 1700000123.75
    }
]"#;

fn as_value(json: &str) -> Value {
    serde_json::from_str(json).expect("literal must be valid JSON")
}

fn reserialized<T: serde::Serialize>(value: &T) -> String {
    serde_json::to_string(value).expect("the payload must serialize")
}

#[test]
fn job_group_decodes_the_python_export_shape() {
    let group: JobGroup =
        serde_json::from_str(PYTHON_JOB_GROUP).expect("a worker's batch must decode");

    assert_eq!(group.jobs.len(), 2);
    assert_eq!(group.jobs[0]["type"], "compilation");
    assert_eq!(group.jobs[1]["type"], "evaluation");
    assert_eq!(group.jobs[0]["operation"]["object_id"], 42);
}

#[test]
fn job_group_survives_a_round_trip_unchanged() {
    let group: JobGroup =
        serde_json::from_str(PYTHON_JOB_GROUP).expect("a worker's batch must decode");

    assert_eq!(as_value(&reserialized(&group)), as_value(PYTHON_JOB_GROUP));
}

#[test]
fn an_empty_batch_is_a_group_with_no_jobs() {
    let group: JobGroup =
        serde_json::from_str(r#"{"jobs": []}"#).expect("an empty batch must decode");

    assert!(group.jobs.is_empty());
    assert_eq!(reserialized(&group), r#"{"jobs":[]}"#);
}

#[test]
fn a_group_without_the_jobs_key_is_rejected() {
    assert!(serde_json::from_str::<JobGroup>(r#"{}"#).is_err());
}

#[test]
fn queue_status_decodes_the_python_get_status_shape() {
    let entries: Vec<QueueEntryDto> =
        serde_json::from_str(PYTHON_QUEUE_STATUS).expect("a queue status reply must decode");

    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0].priority, PRIORITY_MEDIUM);
    assert_eq!(entries[0].item["type"], "evaluate");
    assert_eq!(entries[0].item["multiplicity"], 3);
    assert_eq!(entries[0].timestamp, 1_700_000_000.5);
    assert_eq!(entries[1].priority, PRIORITY_EXTRA_HIGH);
    assert_eq!(entries[1].timestamp, 1_700_000_123.75);
}

#[test]
fn queue_status_entries_survive_a_round_trip_unchanged() {
    let entries: Vec<QueueEntryDto> =
        serde_json::from_str(PYTHON_QUEUE_STATUS).expect("a queue status reply must decode");

    assert_eq!(
        as_value(&reserialized(&entries)),
        as_value(PYTHON_QUEUE_STATUS)
    );
}

#[test]
fn a_queue_entry_serializes_with_the_python_key_names() {
    let mut entries: Vec<QueueEntryDto> =
        serde_json::from_str(PYTHON_QUEUE_STATUS).expect("a queue status reply must decode");
    let entry = entries.remove(0);

    let encoded = as_value(&reserialized(&entry));

    let mut keys: Vec<String> = encoded
        .as_object()
        .expect("an entry must serialize to a JSON object")
        .keys()
        .cloned()
        .collect();
    keys.sort();
    assert_eq!(keys, vec!["item", "priority", "timestamp"]);
}

#[test]
fn an_entry_whose_timestamp_is_not_a_number_is_rejected() {
    let entry = r#"{"item": {"type": "compile"}, "priority": 2, "timestamp": "soon"}"#;

    assert!(serde_json::from_str::<QueueEntryDto>(entry).is_err());
}

#[test]
fn an_entry_without_the_timestamp_key_is_rejected() {
    let entry = r#"{"item": {"type": "compile"}, "priority": 2}"#;

    assert!(serde_json::from_str::<QueueEntryDto>(entry).is_err());
}
