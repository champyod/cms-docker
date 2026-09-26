//! Refusal-rule tests for the envelope guards.
//!
//! `roundtrip.rs` pins the serialized shape; this file pins the decisions a
//! handler makes about a shape it has already accepted. Every expectation here
//! has a counterpart in `src/cms/io/rpc.py`, so a divergence in either
//! direction shows up as a failing test rather than as a rejected call in
//! production.

use cms_proto::{
    check_rpc_secret, ensure_within_size_limit, error, ok, request, EnvelopeError, Request,
    Response, MAX_MESSAGE_SIZE, MESSAGE_TERMINATOR_LEN,
};
use serde_json::{json, Value};

const SECRET: &str = "shh";

fn request_with(id: &str, method: &str) -> Request {
    request(id, method, Value::Null)
}

#[test]
fn request_with_id_and_method_passes_validation() {
    assert_eq!(request_with("abc", "echo").validate(), Ok(()));
}

#[test]
fn empty_request_id_is_rejected() {
    let envelope = request_with("", "echo");
    assert_eq!(envelope.validate(), Err(EnvelopeError::EmptyId));
}

#[test]
fn empty_request_method_is_rejected() {
    let envelope = request_with("abc", "");
    assert_eq!(envelope.validate(), Err(EnvelopeError::EmptyMethod));
}

#[test]
fn empty_id_is_reported_before_empty_method() {
    // The id is what correlates a reply, so an unusable id is the more
    // actionable of the two complaints.
    let envelope = request_with("", "");
    assert_eq!(envelope.validate(), Err(EnvelopeError::EmptyId));
}

#[test]
fn empty_response_id_is_rejected() {
    assert_eq!(ok("", json!(1)).validate(), Err(EnvelopeError::EmptyId));
    assert_eq!(error("", "boom").validate(), Err(EnvelopeError::EmptyId));
}

#[test]
fn validation_messages_name_the_offending_field() {
    let id_message = EnvelopeError::EmptyId.to_string();
    assert!(id_message.contains("__id"), "{id_message}");

    let method_message = EnvelopeError::EmptyMethod.to_string();
    assert!(method_message.contains("__method"), "{method_message}");
}

#[test]
fn request_authentication_accepts_a_matching_secret() {
    let envelope = Request {
        secret: Some(SECRET.to_string()),
        ..request_with("abc", "echo")
    };
    assert_eq!(envelope.authenticate(Some(SECRET)), Ok(()));
}

#[test]
fn request_authentication_refuses_absent_and_empty_secrets() {
    let absent = request_with("abc", "echo");
    let empty = Request {
        secret: Some(String::new()),
        ..request_with("abc", "echo")
    };
    let refused = Err(EnvelopeError::AuthenticationFailed);
    assert_eq!(absent.authenticate(Some(SECRET)), refused);
    assert_eq!(empty.authenticate(Some(SECRET)), refused);
}

#[test]
fn authentication_fails_closed_when_no_secret_is_configured() {
    let envelope = Request {
        secret: Some(SECRET.to_string()),
        ..request_with("abc", "echo")
    };
    assert!(!check_rpc_secret(Some(SECRET), None));
    assert_eq!(
        envelope.authenticate(None),
        Err(EnvelopeError::AuthenticationFailed)
    );
}

#[test]
fn authentication_fails_closed_for_an_empty_configured_secret() {
    assert!(!check_rpc_secret(Some(SECRET), Some("")));
    assert!(!check_rpc_secret(Some(""), Some(SECRET)));
    assert!(!check_rpc_secret(Some(""), Some("")));
}

#[test]
fn a_missing_secret_never_authenticates_even_without_a_configured_one() {
    assert!(!check_rpc_secret(None, Some(SECRET)));
    assert!(!check_rpc_secret(None, None));
    assert!(!check_rpc_secret(None, Some("")));
}

#[test]
fn a_wrong_secret_is_refused_whatever_it_differes_in() {
    assert!(!check_rpc_secret(Some("shh "), Some(SECRET)));
    assert!(!check_rpc_secret(Some("Shh"), Some(SECRET)));
    assert!(!check_rpc_secret(Some("sh"), Some(SECRET)));
    assert!(!check_rpc_secret(Some("shhh"), Some(SECRET)));
    assert!(check_rpc_secret(Some(SECRET), Some(SECRET)));
}

#[test]
fn authentication_failure_message_is_the_one_the_python_side_sends() {
    // `process_incoming_request` puts this exact string on the wire, so a
    // Python caller sees the same refusal from either implementation.
    assert_eq!(
        EnvelopeError::AuthenticationFailed.to_string(),
        "RPC authentication failed."
    );
}

#[test]
fn message_size_limit_matches_the_python_transport() {
    assert_eq!(MAX_MESSAGE_SIZE, 1024 * 1024);
    assert_eq!(MESSAGE_TERMINATOR_LEN, 2);
}

#[test]
fn a_message_that_exactly_fills_the_limit_is_accepted() {
    let payload = MAX_MESSAGE_SIZE - MESSAGE_TERMINATOR_LEN;
    assert_eq!(ensure_within_size_limit(payload), Ok(()));
}

#[test]
fn one_byte_over_the_limit_is_rejected_with_both_sizes() {
    let payload = MAX_MESSAGE_SIZE - MESSAGE_TERMINATOR_LEN + 1;
    let refused = Err(EnvelopeError::MessageTooLarge {
        size: MAX_MESSAGE_SIZE + 1,
        limit: MAX_MESSAGE_SIZE,
    });
    assert_eq!(ensure_within_size_limit(payload), refused);
}

#[test]
fn the_terminator_counts_against_the_limit() {
    // A payload of exactly MAX_MESSAGE_SIZE cannot be framed, so it is refused
    // for the same reason the Python `_write` guard refuses it.
    assert!(ensure_within_size_limit(MAX_MESSAGE_SIZE).is_err());
    assert!(ensure_within_size_limit(MAX_MESSAGE_SIZE - MESSAGE_TERMINATOR_LEN).is_ok());
}

#[test]
fn an_oversize_envelope_fits_a_normal_one_comfortably() {
    let serialized =
        serde_json::to_string(&ok("abc", json!({"answer": 42}))).expect("response serializes");
    assert!(ensure_within_size_limit(serialized.len()).is_ok());
}

#[test]
fn validation_does_not_change_the_serialized_shape() {
    // Rejecting a bad envelope must not also change what a good one puts on
    // the wire: a guard that rewrote keys would be a protocol break.
    let envelope = request_with("abc", "echo");
    let before = serde_json::to_string(&envelope).expect("request serializes");
    envelope.validate().expect("valid envelope");
    let after = serde_json::to_string(&envelope).expect("request serializes");
    assert_eq!(before, after);
    assert_eq!(before, r#"{"__id":"abc","__method":"echo","__data":null}"#);
}

#[test]
fn a_response_deserialized_from_the_python_shape_validates() {
    let decoded: Response = serde_json::from_str(r#"{"__id":"abc","__data":null,"__error":null}"#)
        .expect("python response decodes");
    assert_eq!(decoded.validate(), Ok(()));
}

#[test]
fn formatting_a_request_never_reveals_the_secret() {
    // `rpc.py` never logs the secret, so neither does a `{:?}` in a log line or
    // a panic message.
    let envelope = Request {
        secret: Some(SECRET.to_string()),
        ..request_with("abc", "echo")
    };
    let formatted = format!("{envelope:?}");
    assert!(!formatted.contains(SECRET), "{formatted}");
    assert!(formatted.contains("<redacted>"), "{formatted}");
}

#[test]
fn a_secret_that_is_not_a_string_is_refused_while_decoding() {
    // The Python side refuses this at authentication; refusing it at decode
    // keeps a malformed secret from ever reaching a handler.
    let wire = r#"{"__id":"abc","__method":"echo","__data":null,"__secret":123}"#;
    let decoded: Result<Request, _> = serde_json::from_str(wire);
    assert!(decoded.is_err());
}
