//! Strict parsing of `plus.tombstone`, independently of the mapper.

use cms_evaluation::{worker_output, WorkerOutputError};
use serde_json::json;

use super::support::{compilation_body, with_tombstone};

fn tombstone(body: serde_json::Value) -> bool {
    worker_output(body.as_object().expect("an object body"))
        .expect("a valid body")
        .tombstone
}

#[test]
fn an_absent_tombstone_reads_false() {
    assert!(!tombstone(compilation_body(true)));
}

#[test]
fn a_null_tombstone_reads_false() {
    let mut body = compilation_body(true);
    body["plus"]
        .as_object_mut()
        .expect("an object")
        .insert("tombstone".to_string(), json!(null));
    assert!(!tombstone(body));
}

#[test]
fn a_false_tombstone_reads_false() {
    let mut body = compilation_body(true);
    body["plus"]
        .as_object_mut()
        .expect("an object")
        .insert("tombstone".to_string(), json!(false));
    assert!(!tombstone(body));
}

#[test]
fn a_true_tombstone_reads_true() {
    assert!(tombstone(with_tombstone(compilation_body(true))));
}

#[test]
fn a_non_boolean_tombstone_is_refused_by_name() {
    let mut body = compilation_body(true);
    body["plus"]
        .as_object_mut()
        .expect("an object")
        .insert("tombstone".to_string(), json!("yes"));
    match worker_output(body.as_object().expect("an object body")) {
        Err(WorkerOutputError::WrongType { key, .. }) => assert_eq!(key, "tombstone"),
        Err(other) => panic!("expected a wrong-type refusal for tombstone, got {other:?}"),
        Ok(output) => panic!("expected a refusal, got a default: {output:?}"),
    }
}
