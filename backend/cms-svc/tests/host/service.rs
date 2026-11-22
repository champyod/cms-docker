//! The base methods every service inherits, over the same socket: `echo`, `quit`, and the gate's backdoor refusal.

use serde_json::{json, Value};

use cms_svc::service;

use crate::{connect, read_reply, send, start, wire, SECRET};

#[test]
fn echo_returns_a_multibyte_string_unchanged() {
    let addr = start(service::methods(), Some(SECRET));
    let mut stream = connect(addr);
    let string = "héllo — 日本語 🎉";

    send(
        &mut stream,
        &wire(&json!({
            "__id": "1",
            "__method": "echo",
            "__data": {"string": string},
            "__secret": SECRET,
        })),
    );

    let reply = read_reply(&mut stream);
    assert_eq!(reply["__id"], json!("1"));
    assert_eq!(reply["__data"], json!(string));
    assert_eq!(reply["__error"], Value::Null);
}

#[test]
fn echo_without_its_argument_is_refused_and_names_it() {
    let addr = start(service::methods(), Some(SECRET));
    let mut stream = connect(addr);

    send(
        &mut stream,
        &wire(&json!({
            "__id": "1",
            "__method": "echo",
            "__data": {},
            "__secret": SECRET,
        })),
    );

    let reply = read_reply(&mut stream);
    assert_eq!(
        reply["__error"],
        json!("echo() missing 1 required positional argument: 'string'")
    );
}

#[test]
fn quit_without_a_host_to_stop_is_refused_and_the_host_keeps_serving() {
    let addr = start(service::methods(), Some(SECRET));
    let mut stream = connect(addr);

    send(
        &mut stream,
        &wire(&json!({
            "__id": "1",
            "__method": "quit",
            "__data": {"reason": "nobody attached a stop"},
            "__secret": SECRET,
        })),
    );

    let reply = read_reply(&mut stream);
    assert_eq!(
        reply["__error"],
        json!("quit has no host to stop; attach the host's stop handle with service::attach_stop")
    );

    send(
        &mut stream,
        &wire(&json!({
            "__id": "2",
            "__method": "echo",
            "__data": {"string": "still here"},
            "__secret": SECRET,
        })),
    );
    assert_eq!(read_reply(&mut stream)["__data"], json!("still here"));
}

#[test]
fn the_gate_still_refuses_both_backdoor_methods() {
    let addr = start(service::methods(), Some(SECRET));
    let mut stream = connect(addr);

    for (id, method) in [("1", "start_backdoor"), ("2", "stop_backdoor")] {
        send(
            &mut stream,
            &wire(&json!({
                "__id": id,
                "__method": method,
                "__data": {},
                "__secret": SECRET,
            })),
        );

        let reply = read_reply(&mut stream);
        assert_eq!(reply["__id"], json!(id));
        assert_eq!(
            reply["__error"],
            json!("Backdoor RPC is disabled."),
            "{method} must be refused by the gate, not answered by a handler"
        );
    }

    send(
        &mut stream,
        &wire(&json!({
            "__id": "3",
            "__method": "echo",
            "__data": {"string": "ungated"},
            "__secret": SECRET,
        })),
    );
    assert_eq!(read_reply(&mut stream)["__data"], json!("ungated"));
}
