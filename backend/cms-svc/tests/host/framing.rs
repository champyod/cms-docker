//! Framing at the connection: a message split across two reads, and one that is
//! too large to be read at all.

use std::io::{ErrorKind, Write};

use cms_proto::MAX_MESSAGE_SIZE;
use serde_json::json;

use crate::{
    answer_with_arguments, callable, connect, read_reply, read_until_closed, send, start, wire,
    SECRET,
};

#[test]
fn a_message_split_across_two_writes_is_reassembled() {
    let addr = start(vec![callable("echo", answer_with_arguments)], Some(SECRET));
    let mut stream = connect(addr);
    let framed = wire(&json!({
        "__id": "split",
        "__method": "echo",
        "__data": {"half": "of a message"},
        "__secret": SECRET,
    }));
    let (head, tail) = framed.split_at(framed.len() / 2);

    send(&mut stream, head);
    send(&mut stream, tail);

    let reply = read_reply(&mut stream);
    assert_eq!(reply["__id"], json!("split"));
    assert_eq!(reply["__data"], json!({"half": "of a message"}));
}

#[test]
fn a_message_larger_than_the_limit_is_refused_without_a_reply() {
    let addr = start(vec![callable("echo", answer_with_arguments)], Some(SECRET));
    let mut stream = connect(addr);
    let oversized = vec![b'x'; MAX_MESSAGE_SIZE];

    if let Err(error) = stream.write_all(&oversized) {
        // WHY: the host closes as soon as the frame can no longer fit, so the
        // tail of this write may find the connection already gone.
        assert!(
            matches!(
                error.kind(),
                ErrorKind::BrokenPipe | ErrorKind::ConnectionReset
            ),
            "the write may only fail because the host closed: {error}"
        );
    }

    assert!(
        read_until_closed(&mut stream).is_empty(),
        "an oversized message is dropped, not answered"
    );
}
