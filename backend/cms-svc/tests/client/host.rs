//! Calls and refusals observed through a real `cms-svc` host.

use cms_proto::MAX_MESSAGE_SIZE;
use cms_svc::{Client, ClientError};
use serde_json::json;

use crate::{assert_no_secret, TestHost, SECRET};

#[test]
fn a_configured_secret_is_accepted() {
    let host = TestHost::start(Some(SECRET));
    let mut client = Client::connect(host.addr(), Some(SECRET.to_owned()))
        .expect("the client reaches the listening host");

    assert_eq!(
        client
            .echo("authenticated")
            .expect("the right secret passes the host gate"),
        json!("authenticated")
    );
}

#[test]
fn a_wrong_secret_is_refused_without_being_disclosed() {
    let host = TestHost::start(Some(SECRET));
    let wrong_secret = format!("{SECRET}-wrong");
    let mut client = Client::connect(host.addr(), Some(wrong_secret.clone()))
        .expect("the client reaches the listening host");

    let error = client
        .echo("must not run")
        .expect_err("the host refuses the wrong secret");
    assert_refused(error, "RPC authentication failed.", &wrong_secret);
}

#[test]
fn a_missing_secret_is_refused_without_being_disclosed() {
    let host = TestHost::start(Some(SECRET));
    let mut client =
        Client::connect(host.addr(), None).expect("the client reaches the listening host");

    let error = client
        .echo("must not run")
        .expect_err("the host refuses a request without a secret");
    assert_refused(error, "RPC authentication failed.", SECRET);
}

#[test]
fn an_unknown_method_is_refused_with_the_hosts_text() {
    let host = TestHost::start(Some(SECRET));
    let mut client = Client::connect(host.addr(), Some(SECRET.to_owned()))
        .expect("the client reaches the listening host");

    let error = client
        .call("missing_method", json!({}))
        .expect_err("the host refuses a method it does not expose");
    assert_refused(error, "Method missing_method doesn't exist.", SECRET);
}

#[test]
fn non_object_data_is_refused() {
    let host = TestHost::start(Some(SECRET));
    let mut client = Client::connect(host.addr(), Some(SECRET.to_owned()))
        .expect("the client reaches the listening host");

    let error = client
        .call("echo", json!(["not", "keyword", "arguments"]))
        .expect_err("the codec refuses non-object arguments");
    assert_refused(error, "__data is not an object.", SECRET);
}

#[test]
fn an_oversized_request_is_refused_before_it_is_written() {
    let host = TestHost::start(Some(SECRET));
    let mut client = Client::connect(host.addr(), Some(SECRET.to_owned()))
        .expect("the client reaches the listening host");

    let error = client
        .call("echo", json!({ "string": "x".repeat(MAX_MESSAGE_SIZE) }))
        .expect_err("the codec refuses a request over the size limit");
    assert!(matches!(error, ClientError::Frame(_)), "{error:?}");
    assert_no_secret(&error, SECRET);
}

/// Checks the exact refusal and every rendering of its error for secret leakage.
fn assert_refused(error: ClientError, expected: &str, secret: &str) {
    assert!(
        matches!(&error, ClientError::Refused(message) if message == expected),
        "{error:?}"
    );
    assert_no_secret(&error, secret);
}
