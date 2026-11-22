//! A call the gate lets through: its data comes back, keyed with its own id.

use serde_json::{json, Value};

use crate::{answer_with_arguments, callable, connect, read_reply, send, start, wire, SECRET};

#[test]
fn a_valid_call_returns_its_data_and_echoes_its_id() {
    let addr = start(vec![callable("echo", answer_with_arguments)], Some(SECRET));
    let mut stream = connect(addr);

    send(
        &mut stream,
        &wire(&json!({
            "__id": "abc",
            "__method": "echo",
            "__data": {"answer": 42},
            "__secret": SECRET,
        })),
    );

    let reply = read_reply(&mut stream);
    assert_eq!(reply["__id"], json!("abc"));
    assert_eq!(reply["__data"], json!({"answer": 42}));
    assert_eq!(reply["__error"], Value::Null);
}

#[test]
fn one_connection_answers_every_frame_it_holds() {
    let addr = start(vec![callable("echo", answer_with_arguments)], Some(SECRET));
    let mut stream = connect(addr);
    let mut frames = wire(&json!({
        "__id": "1",
        "__method": "echo",
        "__data": {"n": 1},
        "__secret": SECRET,
    }));
    frames.extend_from_slice(&wire(&json!({
        "__id": "2",
        "__method": "echo",
        "__data": {"n": 2},
        "__secret": SECRET,
    })));

    send(&mut stream, &frames);

    let first = read_reply(&mut stream);
    let second = read_reply(&mut stream);
    assert_eq!(first["__id"], json!("1"));
    assert_eq!(first["__data"], json!({"n": 1}));
    assert_eq!(second["__id"], json!("2"));
    assert_eq!(second["__data"], json!({"n": 2}));
}
