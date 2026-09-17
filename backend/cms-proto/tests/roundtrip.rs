//! Round-trip and wire-shape tests for the RPC envelope types.
//!
//! The wire contract comes from `src/cms/io/rpc.py`: the Python side
//! checks field names verbatim and builds responses with all three
//! keys, so these tests pin the serialized shape, not just the values.

use cms_proto::{error, ok, request, Request, Response};
use serde_json::{json, Value};

fn sorted_keys(object: &str) -> Vec<String> {
    let value: Value = serde_json::from_str(object).unwrap();
    let mut keys: Vec<String> = value
        .as_object()
        .expect("envelope must serialize to a JSON object")
        .keys()
        .cloned()
        .collect();
    keys.sort();
    keys
}

#[test]
fn request_serializes_exactly_python_field_names() {
    let envelope = request("id-1", "some_method", json!({"x": 1}));

    let serialized = serde_json::to_string(&envelope).unwrap();
    assert_eq!(sorted_keys(&serialized), vec!["__data", "__id", "__method"]);

    let value: Value = serde_json::from_str(&serialized).unwrap();
    assert_eq!(value["__id"], json!("id-1"));
    assert_eq!(value["__method"], json!("some_method"));
    assert_eq!(value["__data"], json!({"x": 1}));
}

#[test]
fn request_includes_secret_key_only_when_present() {
    let authenticated = Request {
        secret: Some("shh".to_string()),
        ..request("id-1", "some_method", json!(null))
    };

    let serialized = serde_json::to_string(&authenticated).unwrap();
    assert_eq!(
        sorted_keys(&serialized),
        vec!["__data", "__id", "__method", "__secret"]
    );
    let value: Value = serde_json::from_str(&serialized).unwrap();
    assert_eq!(value["__secret"], json!("shh"));
}

#[test]
fn request_with_no_secret_omits_secret_key() {
    let envelope = request("id-1", "some_method", json!(null));

    let serialized = serde_json::to_string(&envelope).unwrap();
    assert_eq!(sorted_keys(&serialized), vec!["__data", "__id", "__method"]);
    let value: Value = serde_json::from_str(&serialized).unwrap();
    assert!(value.get("__secret").is_none());
}

#[test]
fn response_serializes_all_three_keys_with_null_error() {
    let envelope = ok("id-1", json!([1, 2, 3]));

    let serialized = serde_json::to_string(&envelope).unwrap();
    assert_eq!(sorted_keys(&serialized), vec!["__data", "__error", "__id"]);

    let value: Value = serde_json::from_str(&serialized).unwrap();
    assert_eq!(value["__id"], json!("id-1"));
    assert_eq!(value["__data"], json!([1, 2, 3]));
    assert_eq!(value["__error"], Value::Null);
}

#[test]
fn response_serializes_error_message_as_string() {
    let envelope = error("id-1", "Method foo doesn't exist.");

    let serialized = serde_json::to_string(&envelope).unwrap();
    let value: Value = serde_json::from_str(&serialized).unwrap();
    assert_eq!(value["__error"], json!("Method foo doesn't exist."));
    assert_eq!(value["__data"], Value::Null);
}

#[test]
fn request_round_trip_preserves_semantics() {
    let envelope = Request {
        data: json!({"nested": {"list": [1, 2.5, null, true]}, "text": "héllo"}),
        secret: Some("shh".to_string()),
        ..request("id-1", "some_method", json!(null))
    };

    let serialized = serde_json::to_string(&envelope).unwrap();
    let decoded: Request = serde_json::from_str(&serialized).unwrap();
    assert_eq!(decoded, envelope);
}

#[test]
fn response_round_trip_preserves_semantics() {
    let envelope = ok("id-1", json!({"answer": 42}));

    let serialized = serde_json::to_string(&envelope).unwrap();
    let decoded: Response = serde_json::from_str(&serialized).unwrap();
    assert_eq!(decoded, envelope);
}

#[test]
fn python_shaped_request_deserializes() {
    // Exactly what rpc.py's execute_rpc builds for an authenticated call.
    let python_json = r#"{
        "__id": "6f9619ff8b86",
        "__method": "submissions",
        "__data": {"user_id": 7, "with_status": true},
        "__secret": "shh"
    }"#;

    let decoded: Request = serde_json::from_str(python_json).unwrap();
    assert_eq!(decoded.id, "6f9619ff8b86");
    assert_eq!(decoded.method, "submissions");
    assert_eq!(decoded.data, json!({"user_id": 7, "with_status": true}));
    assert_eq!(decoded.secret.as_deref(), Some("shh"));
}

#[test]
fn python_shaped_request_without_secret_deserializes() {
    let python_json = r#"{"__id": "abc", "__method": "echo", "__data": null}"#;

    let decoded: Request = serde_json::from_str(python_json).unwrap();
    assert_eq!(decoded.id, "abc");
    assert_eq!(decoded.secret, None);
}

#[test]
fn python_shaped_response_deserializes() {
    // Exactly what rpc.py's process_incoming_request builds: three keys,
    // __data and __error always present, null when there is no result.
    let python_json = r#"{
        "__id": "6f9619ff8b86",
        "__data": null,
        "__error": null
    }"#;

    let decoded: Response = serde_json::from_str(python_json).unwrap();
    assert_eq!(decoded.id, "6f9619ff8b86");
    assert_eq!(decoded.data, Value::Null);
    assert_eq!(decoded.error, None);
}
