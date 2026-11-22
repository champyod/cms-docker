//! What the host refuses, each with the proof that the refused method never ran.

use std::sync::atomic::{AtomicUsize, Ordering};

use serde_json::{json, Value};

use crate::{
    answer_with_arguments, callable, connect, read_reply, read_until_closed, send, start,
    uncallable, wire, SECRET,
};

/// Calls the handler behind a wrong secret would have seen.
static UNTRUSTED_CALLS: AtomicUsize = AtomicUsize::new(0);

/// Calls the handler that is not callable would have seen.
static UNCALLABLE_CALLS: AtomicUsize = AtomicUsize::new(0);

fn count_untrusted(_data: &Value) -> Result<Value, String> {
    UNTRUSTED_CALLS.fetch_add(1, Ordering::SeqCst);
    Ok(json!("ran"))
}

fn count_uncallable(_data: &Value) -> Result<Value, String> {
    UNCALLABLE_CALLS.fetch_add(1, Ordering::SeqCst);
    Ok(json!("ran"))
}

#[test]
fn a_wrong_secret_is_refused_and_the_method_does_not_run() {
    let addr = start(vec![callable("guarded", count_untrusted)], Some(SECRET));
    let mut stream = connect(addr);

    send(
        &mut stream,
        &wire(&json!({
            "__id": "1",
            "__method": "guarded",
            "__data": {},
            "__secret": "not the secret",
        })),
    );

    let reply = read_reply(&mut stream);
    assert_eq!(reply["__id"], json!("1"));
    assert_eq!(reply["__error"], json!("RPC authentication failed."));
    assert_eq!(reply["__data"], Value::Null);
    assert_eq!(
        UNTRUSTED_CALLS.load(Ordering::SeqCst),
        0,
        "a refused call is never dispatched"
    );

    // A refusal is written rather than dropped, so the connection still carries this caller's next call.
    send(
        &mut stream,
        &wire(&json!({
            "__id": "2",
            "__method": "guarded",
            "__data": {},
            "__secret": SECRET,
        })),
    );
    assert_eq!(read_reply(&mut stream)["__data"], json!("ran"));
    assert_eq!(UNTRUSTED_CALLS.load(Ordering::SeqCst), 1);
}

#[test]
fn a_request_without_an_id_closes_the_connection_without_a_reply() {
    let addr = start(vec![callable("echo", answer_with_arguments)], Some(SECRET));
    let mut stream = connect(addr);

    send(
        &mut stream,
        &wire(&json!({
            "__method": "echo",
            "__data": {},
            "__secret": SECRET,
        })),
    );

    assert!(
        read_until_closed(&mut stream).is_empty(),
        "a message with no id has no reply, only a close"
    );
}

#[test]
fn a_method_other_services_may_not_call_is_refused() {
    let addr = start(vec![uncallable("reset", count_uncallable)], Some(SECRET));
    let mut stream = connect(addr);

    send(
        &mut stream,
        &wire(&json!({
            "__id": "3",
            "__method": "reset",
            "__data": {},
            "__secret": SECRET,
        })),
    );

    let reply = read_reply(&mut stream);
    assert_eq!(reply["__error"], json!("Method reset isn't callable."));
    assert_eq!(
        UNCALLABLE_CALLS.load(Ordering::SeqCst),
        0,
        "a method present but not callable is never dispatched"
    );
}
