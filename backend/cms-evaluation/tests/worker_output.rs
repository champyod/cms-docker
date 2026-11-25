//! Strict parsing of returned worker job bodies into storable result fields.
//!
//! Pure: no database, no Python, no service loop.

use cms_evaluation::{worker_output, RunStats, WorkerOutput, WorkerOutputError};
use cms_proto::DigestMap;
use serde_json::{json, Value};

/// A valid SHA-1 digest, forty lowercase hex digits.
const DIGEST: &str = "0123456789abcdef0123456789abcdef01234567";

fn run(body: Value) -> Result<WorkerOutput, WorkerOutputError> {
    worker_output(body.as_object().expect("an object body"))
}

fn digests(entries: &[(&str, &str)]) -> DigestMap {
    entries
        .iter()
        .map(|(name, digest)| ((*name).to_owned(), (*digest).to_owned()))
        .collect()
}

fn full_plus() -> Value {
    json!({
        "execution_time": 1.5,
        "execution_wall_clock_time": 2.5,
        "execution_memory": 4096,
        "exit_status": "ok",
        "signal": 9,
        "stdout": "out",
        "stderr": "err",
    })
}

fn full_stats() -> RunStats {
    RunStats {
        execution_time: Some(1.5),
        wall_clock_time: Some(2.5),
        memory_bytes: Some(4096),
        stdout: Some("out".to_owned()),
        stderr: Some("err".to_owned()),
    }
}

fn empty_stats() -> RunStats {
    RunStats {
        execution_time: None,
        wall_clock_time: None,
        memory_bytes: None,
        stdout: None,
        stderr: None,
    }
}

fn expect_wrong_type(body: Value, key: &str) {
    match run(body) {
        Err(WorkerOutputError::WrongType { key: found, .. }) => assert_eq!(found, key),
        Err(other) => panic!("expected a wrong-type refusal for `{key}`, got {other:?}"),
        Ok(out) => panic!("expected a refusal for `{key}`, got a default: {out:?}"),
    }
}

fn expect_missing(body: Value, key: &str) {
    match run(body) {
        Err(WorkerOutputError::MissingKey { key: found }) => assert_eq!(found, key),
        Err(other) => panic!("expected a missing-key refusal for `{key}`, got {other:?}"),
        Ok(out) => panic!("expected a refusal for `{key}`, got a default: {out:?}"),
    }
}

fn expect_bad_digest(body: Value, key: &str) {
    match run(body) {
        Err(WorkerOutputError::BadDigest { key: found, .. }) => assert_eq!(found, key),
        Err(other) => panic!("expected a bad-digest refusal for `{key}`, got {other:?}"),
        Ok(out) => panic!("expected a refusal for `{key}`, got a default: {out:?}"),
    }
}

#[test]
fn successful_compilation_parses_every_field() {
    let body = json!({
        "success": true,
        "compilation_success": true,
        "text": ["line a", "line b", "line c"],
        "sandboxes": ["box/one", "box/two"],
        "sandbox_digests": {"box/one": DIGEST},
        "executables": {"a.out": DIGEST},
        "plus": full_plus(),
    });
    let out = run(body).expect("a valid compilation body parses");
    assert!(out.success);
    assert_eq!(out.compilation_success, Some(true));
    assert_eq!(
        out.text,
        Some(vec![
            "line a".to_owned(),
            "line b".to_owned(),
            "line c".to_owned(),
        ])
    );
    assert_eq!(
        out.sandboxes,
        vec!["box/one".to_owned(), "box/two".to_owned()]
    );
    assert_eq!(out.sandbox_digests, digests(&[("box/one", DIGEST)]));
    assert_eq!(out.executables, digests(&[("a.out", DIGEST)]));
    assert_eq!(out.stats, Some(full_stats()));
    assert_eq!(out.outcome, None);
    assert_eq!(out.admin_text, None);
    assert_eq!(out.user_output, None);
}

#[test]
fn successful_evaluation_preserves_outcome_and_null_text() {
    let body = json!({
        "success": true,
        "outcome": "1.0",
        "text": null,
        "admin_text": "internal note",
        "user_output": DIGEST,
        "sandboxes": [],
        "sandbox_digests": {},
        "plus": {},
    });
    let out = run(body).expect("a valid evaluation body parses");
    assert!(out.success);
    assert_eq!(out.outcome.as_deref(), Some("1.0"));
    assert_eq!(out.text, None);
    assert_eq!(out.admin_text.as_deref(), Some("internal note"));
    assert_eq!(out.user_output.as_ref().map(|d| d.as_str()), Some(DIGEST));
    assert!(out.sandboxes.is_empty());
    assert!(out.sandbox_digests.is_empty());
    assert!(out.executables.is_empty());
    assert_eq!(out.compilation_success, None);
    assert_eq!(out.stats, Some(empty_stats()));
}

#[test]
fn failed_compilation_defaults_are_none_and_empty() {
    let body = json!({
        "success": false,
        "compilation_success": null,
        "text": null,
        "plus": null,
    });
    let out = run(body).expect("a failed compilation body parses");
    assert!(!out.success);
    assert_eq!(out.compilation_success, None);
    assert_eq!(out.text, None);
    assert!(out.sandboxes.is_empty());
    assert!(out.sandbox_digests.is_empty());
    assert!(out.executables.is_empty());
    assert_eq!(out.stats, None);
}

#[test]
fn missing_success_is_refused() {
    expect_missing(json!({ "text": [] }), "success");
}

#[test]
fn success_not_bool_is_refused() {
    expect_wrong_type(json!({ "success": "yes" }), "success");
}

#[test]
fn sandboxes_not_array_is_refused() {
    expect_wrong_type(json!({ "success": true, "sandboxes": 5 }), "sandboxes");
}

#[test]
fn digest_map_value_not_string_is_refused() {
    expect_wrong_type(
        json!({ "success": true, "sandbox_digests": { "a": 1 } }),
        "sandbox_digests",
    );
}

#[test]
fn plus_not_object_is_refused() {
    expect_wrong_type(json!({ "success": true, "plus": [] }), "plus");
}

#[test]
fn execution_time_not_number_is_refused() {
    expect_wrong_type(
        json!({ "success": true, "plus": { "execution_time": "slow" } }),
        "execution_time",
    );
}

#[test]
fn user_output_invalid_digest_is_refused() {
    expect_bad_digest(
        json!({ "success": true, "user_output": "not-a-digest" }),
        "user_output",
    );
}
