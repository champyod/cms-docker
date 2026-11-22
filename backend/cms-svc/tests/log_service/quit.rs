//! `quit` over the wire: the reply, the reason, the exit code, and what a second connection changes.

use std::net::TcpStream;

use serde_json::{json, Value};

use crate::{call, connect, finish, started, Sandbox};

#[test]
fn quit_stops_the_process_and_it_exits_zero() {
    let sandbox = Sandbox::new("quit-zero");
    let (running, addr) = started(&sandbox);
    let mut stream = connect(addr);

    let string = "héllo — 日本語 🎉";
    assert_eq!(
        call(&mut stream, "1", "echo", json!({"string": string}))["__data"],
        json!(string),
        "the composed table serves the base method too"
    );
    assert_eq!(
        call(&mut stream, "2", "quit", json!({"reason": "asked to stop"}))["__data"],
        Value::Null
    );

    let (status, stderr) = finish(running);
    assert!(status.success(), "a plain quit exits zero, got {status:?}");
    assert!(
        stderr.contains("Trying to exit as asked by another service (asked to stop)."),
        "the reason must be the one it was given, got: {stderr}"
    );
    assert!(
        TcpStream::connect(addr).is_err(),
        "a stopped service accepts nothing new"
    );
}

#[test]
fn quit_with_fatal_stops_the_process_with_a_failure_status() {
    let sandbox = Sandbox::new("quit-fatal");
    let (running, addr) = started(&sandbox);
    let mut stream = connect(addr);

    assert_eq!(
        call(
            &mut stream,
            "1",
            "quit",
            json!({"reason": "restart me", "fatal": true})
        )["__data"],
        Value::Null
    );

    let (status, stderr) = finish(running);
    assert!(
        !status.success(),
        "a fatal quit must tell a supervisor to restart it, got {status:?}"
    );
    assert!(
        stderr.contains("(restart me)"),
        "the reason must be named, got: {stderr}"
    );
}

#[test]
fn quit_stops_the_service_while_a_second_connection_is_open() {
    let sandbox = Sandbox::new("quit-second");
    let (running, addr) = started(&sandbox);
    let mut first = connect(addr);
    let mut second = connect(addr);

    assert_eq!(
        call(&mut first, "1", "echo", json!({"string": "first"}))["__data"],
        json!("first"),
        "the first connection is served before the stop"
    );
    assert_eq!(
        call(&mut second, "2", "echo", json!({"string": "second"}))["__data"],
        json!("second"),
        "the second connection is served too, so both threads exist"
    );
    assert_eq!(
        call(&mut second, "3", "quit", json!({"reason": "two open"}))["__data"],
        Value::Null,
        "the caller is answered before the process goes"
    );

    let (status, stderr) = finish(running);
    assert!(
        status.success(),
        "an idle connection must not hold the stop, got {status:?}"
    );
    assert!(stderr.contains("(two open)"), "the reason must be named");
}
