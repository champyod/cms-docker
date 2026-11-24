//! Protocol failures and error rendering against scripted listeners.

use std::error::Error;
use std::io;

use cms_proto::{ok, FrameError, Response};
use cms_svc::{Client, ClientError};
use serde_json::{json, Value};

use crate::scripted::{frame, response, serve_twice, serve_with};
use crate::{assert_no_secret, SECRET};

#[test]
fn a_response_with_a_different_id_is_rejected() {
    let (addr, server) = serve_with(|_request| {
        response(&Response {
            id: "another-request".to_owned(),
            data: json!({"unexpected": true}),
            error: None,
        })
    });
    let mut client = Client::connect(addr, Some(SECRET.to_owned()))
        .expect("the client reaches the scripted listener");

    let error = client
        .call("echo", json!({"string": "hello"}))
        .expect_err("a reply for another request is a protocol failure");
    let captured = server.join().expect("the scripted listener finishes");
    let ClientError::MismatchedId { expected, received } = &error else {
        panic!("a different response id is reported as MismatchedId: {error:?}");
    };
    assert_eq!(expected, &captured.request.id);
    assert_eq!(received, "another-request");
    assert!(error.to_string().contains(expected));
    assert!(error.to_string().contains(received));
    assert_no_secret(&error, SECRET);
}

#[test]
fn a_non_string_error_payload_is_rendered_as_json() {
    let payload = json!({"reason": ["denied", 7]});
    let expected = r#"{"reason":["denied",7]}"#;
    let (addr, server) = serve_with(move |request| {
        response(&Response {
            id: request.id.clone(),
            data: Value::Null,
            error: Some(payload.clone()),
        })
    });
    let mut client = Client::connect(addr, Some(SECRET.to_owned()))
        .expect("the client reaches the scripted listener");

    let error = client
        .call("echo", json!({}))
        .expect_err("a non-null error is a refusal");
    server.join().expect("the scripted listener finishes");
    let ClientError::Refused(message) = &error else {
        panic!("a non-null error is reported as Refused: {error:?}");
    };
    assert_eq!(message, expected);
    assert_no_secret(&error, SECRET);
}

#[test]
fn a_missing_secret_key_is_omitted_from_the_request() {
    let (addr, server) =
        serve_with(|request| response(&ok(request.id.clone(), request.data.clone())));
    let mut client = Client::connect(addr, None).expect("the client reaches the scripted listener");

    assert_eq!(
        client
            .call("echo", json!({"string": "no secret"}))
            .expect("the scripted listener answers"),
        json!({"string": "no secret"})
    );
    let captured = server.join().expect("the scripted listener finishes");
    assert_eq!(captured.request.secret, None);
    assert!(!captured
        .envelope
        .as_object()
        .unwrap()
        .contains_key("__secret"));
}

#[test]
fn a_configured_secret_is_sent_with_the_request() {
    let (addr, server) =
        serve_with(|request| response(&ok(request.id.clone(), request.data.clone())));
    let mut client = Client::connect(addr, Some(SECRET.to_owned()))
        .expect("the client reaches the scripted listener");

    client
        .call("echo", json!({}))
        .expect("the scripted listener answers");
    let captured = server.join().expect("the scripted listener finishes");
    assert!(
        captured.request.secret.as_deref() == Some(SECRET),
        "the configured secret was not sent"
    );
    assert!(
        captured.envelope["__secret"] == SECRET,
        "the configured secret was not present on the wire"
    );
}

#[test]
fn calls_reuse_one_connection_with_fresh_ids() {
    let (addr, server) =
        serve_twice(|request| response(&ok(request.id.clone(), request.data.clone())));
    let mut client = Client::connect(addr, None).expect("the client reaches the scripted listener");

    assert_eq!(
        client
            .echo("first")
            .expect("the scripted listener answers the first call"),
        json!({"string": "first"})
    );
    assert_eq!(
        client
            .echo("second")
            .expect("the scripted listener answers the second call"),
        json!({"string": "second"})
    );
    let captured = server.join().expect("the scripted listener finishes");
    assert_eq!(captured.len(), 2);
    assert_ne!(captured[0].request.id, captured[1].request.id);
}

#[test]
fn invalid_json_is_a_frame_error_with_a_source() {
    let (addr, server) = serve_with(|_request| b"not json\r\n".to_vec());
    let mut client = Client::connect(addr, Some(SECRET.to_owned()))
        .expect("the client reaches the scripted listener");

    let error = client
        .call("echo", json!({}))
        .expect_err("invalid JSON cannot be a response");
    server.join().expect("the scripted listener finishes");
    assert!(
        matches!(error, ClientError::Frame(FrameError::NotJson)),
        "{error:?}"
    );
    assert!(error.source().is_some());
    assert_no_secret(&error, SECRET);
}

#[test]
fn a_non_object_frame_is_a_frame_error_with_a_source() {
    let (addr, server) = serve_with(|_request| frame(&json!([])));
    let mut client = Client::connect(addr, Some(SECRET.to_owned()))
        .expect("the client reaches the scripted listener");

    let error = client
        .call("echo", json!({}))
        .expect_err("a non-object cannot be a response envelope");
    server.join().expect("the scripted listener finishes");
    assert!(
        matches!(error, ClientError::Frame(FrameError::NotAnObject)),
        "{error:?}"
    );
    assert!(error.source().is_some());
    assert_no_secret(&error, SECRET);
}

#[test]
fn a_malformed_envelope_is_a_decode_error_with_a_source() {
    let (addr, server) = serve_with(|_request| frame(&json!({"__id": "missing-data-and-error"})));
    let mut client = Client::connect(addr, Some(SECRET.to_owned()))
        .expect("the client reaches the scripted listener");

    let error = client
        .call("echo", json!({}))
        .expect_err("a frame without response fields cannot be decoded");
    server.join().expect("the scripted listener finishes");
    assert!(matches!(error, ClientError::Decode(_)), "{error:?}");
    assert!(error.source().is_some());
    assert_no_secret(&error, SECRET);
}

#[test]
fn a_closed_connection_is_a_read_error_with_a_source() {
    let (addr, server) = serve_with(|_request| Vec::new());
    let mut client = Client::connect(addr, Some(SECRET.to_owned()))
        .expect("the client reaches the scripted listener");

    let error = client
        .call("echo", json!({}))
        .expect_err("a closed connection has no response");
    server.join().expect("the scripted listener finishes");
    let ClientError::Read(error) = error else {
        panic!("a closed connection is reported as Read: {error:?}");
    };
    assert_eq!(error.kind(), io::ErrorKind::UnexpectedEof);
    assert_no_secret(&ClientError::Read(error), SECRET);
}

#[test]
fn a_refused_connection_is_a_connect_error_with_a_source() {
    let error = Client::connect("127.0.0.1:0", Some(SECRET.to_owned())).err();
    let Some(ClientError::Connect(error)) = error else {
        panic!("a failed dial is reported as Connect: {error:?}");
    };
    assert_eq!(error.kind(), io::ErrorKind::ConnectionRefused);
    assert_no_secret(&ClientError::Connect(error), SECRET);
}
