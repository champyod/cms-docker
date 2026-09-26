//! Framing tests for the connection buffer and the wire limit.
//!
//! `validation.rs` pins the decisions made about an envelope that has already
//! been accepted; this file pins the decisions made before that, on the bytes
//! themselves. Every boundary here is derived from the same arithmetic
//! `ensure_within_size_limit` uses, so a frame cannot be readable in one
//! direction and sendable in the other.

use cms_proto::{
    encode, ensure_within_size_limit, error, ok, request, EnvelopeError, Frame, FrameError,
    FrameRefusal, Framer, MAX_MESSAGE_SIZE, MESSAGE_TERMINATOR_LEN,
};
use serde_json::{json, Value};

/// Largest payload both directions still frame.
const LARGEST_PAYLOAD: usize = MAX_MESSAGE_SIZE - MESSAGE_TERMINATOR_LEN;

/// One byte more than a frame may carry.
const OVERSIZE_PAYLOAD: usize = LARGEST_PAYLOAD + 1;

/// Bytes the largest frame is dribbled in, so trickling it costs thousands of
/// reads rather than one.
const TRICKLE_CHUNK: usize = 512;

/// An error string shaped like the one the Python side builds: a message and a
/// traceback, both full of newlines.
const MULTILINE_ERROR: &str =
    "ValueError: boom\n  File \"service.py\", line 42, in echo\n    raise ValueError\n";

/// A request whose serialized form is exactly `total` bytes.
fn request_of_size(total: usize) -> Value {
    let mut envelope = json!({"__id": "abc", "__method": "echo", "__data": {"pad": ""}});
    let overhead = serde_json::to_string(&envelope)
        .expect("envelope serializes")
        .len();
    envelope["__data"]["pad"] = Value::String("x".repeat(total - overhead));
    envelope
}

/// A request payload of exactly `total` bytes on the wire.
fn payload_of_size(total: usize) -> Vec<u8> {
    let payload = serde_json::to_vec(&request_of_size(total)).expect("envelope serializes");
    assert_eq!(payload.len(), total, "test built the wrong size");
    payload
}

/// A framer holding one whole frame, terminator included.
fn framer_holding(frame: &[u8]) -> Framer {
    let mut framer = Framer::default();
    framer.push(frame).expect("frame fits the limit");
    framer
}

/// The one frame the framer has ready.
fn only_frame(framer: &mut Framer) -> Frame {
    framer
        .next_frame()
        .expect("frame decodes")
        .expect("frame present")
}

/// Why the framer dropped the frame it could not read.
fn drop_reason(framer: &mut Framer) -> FrameError {
    framer.next_frame().expect_err("the frame is dropped")
}

#[test]
fn a_framed_message_is_the_payload_plus_exactly_one_terminator() {
    let reply = ok("abc", json!({"answer": 42}));
    let wire = encode(&reply).expect("reply frames");
    let payload = serde_json::to_vec(&reply).expect("reply serializes");

    assert_eq!(wire.len(), payload.len() + MESSAGE_TERMINATOR_LEN);
    assert!(wire.ends_with(b"\r\n"), "{wire:?}");
}

#[test]
fn a_payload_that_fills_the_limit_is_accepted_in_both_directions() {
    let payload = payload_of_size(LARGEST_PAYLOAD);
    assert_eq!(ensure_within_size_limit(payload.len()), Ok(()));

    let wire = encode(&request_of_size(LARGEST_PAYLOAD)).expect("largest payload frames");
    assert_eq!(wire.len(), MAX_MESSAGE_SIZE);

    let mut framer = framer_holding(&wire);
    let frame = only_frame(&mut framer);
    assert_eq!(frame.value, request_of_size(LARGEST_PAYLOAD));
    assert_eq!(frame.payload_len, LARGEST_PAYLOAD);
    assert_eq!(frame.refusal, None);
    assert!(framer.next_frame().expect("nothing left").is_none());
}

#[test]
fn one_byte_over_the_limit_is_refused_in_both_directions() {
    let refused =
        ensure_within_size_limit(OVERSIZE_PAYLOAD).expect_err("the guards refuse the same payload");
    let payload = payload_of_size(OVERSIZE_PAYLOAD);

    let send = encode(&request_of_size(OVERSIZE_PAYLOAD)).expect_err("oversize is not sendable");
    assert_eq!(send, FrameError::TooLarge(refused.clone()));

    let mut framer = framer_holding(&payload);
    framer
        .push(b"\r\n")
        .expect("the terminator is not a message");
    assert_eq!(
        drop_reason(&mut framer),
        FrameError::TooLarge(refused.clone())
    );
    assert_eq!(
        refused,
        EnvelopeError::MessageTooLarge {
            size: MAX_MESSAGE_SIZE + 1,
            limit: MAX_MESSAGE_SIZE,
        }
    );
}

#[test]
fn an_error_string_of_several_lines_stays_one_frame() {
    let wire = encode(&error("abc", MULTILINE_ERROR)).expect("error reply frames");
    let mut framer = framer_holding(&wire);
    assert!(wire.windows(2).any(|pair| pair == b"\\n"), "{wire:?}");

    let reported = only_frame(&mut framer).value["__error"].clone();
    assert_eq!(
        reported.as_str().expect("error is a string"),
        MULTILINE_ERROR
    );

    // The newlines survive as escaped characters, so the frame they arrived in
    // is still the only frame on the connection.
    assert!(framer.next_frame().expect("nothing left").is_none());
}

#[test]
fn a_frame_trickled_in_small_chunks_decodes_as_it_does_in_one_read() {
    let mut wire = payload_of_size(LARGEST_PAYLOAD);
    wire.extend_from_slice(b"\r\n");
    let mut whole = framer_holding(&wire);

    let mut trickled = Framer::default();
    for chunk in wire.chunks(TRICKLE_CHUNK) {
        trickled.push(chunk).expect("every prefix fits the limit");
    }

    let from_chunks = only_frame(&mut trickled);
    let from_one_read = only_frame(&mut whole);
    assert_eq!(from_chunks.payload_len, from_one_read.payload_len);
    assert_eq!(from_chunks.value, from_one_read.value);
    assert!(trickled.next_frame().expect("nothing left").is_none());
}

#[test]
fn several_frames_in_one_read_decode_one_per_call_in_order() {
    let first = encode(&ok("first", json!(1))).expect("first reply frames");
    let second = encode(&ok("second", json!(2))).expect("second reply frames");
    let mut framer = framer_holding(&first);
    framer.push(&second).expect("second reply fits");

    let mut ids = Vec::new();
    while let Some(frame) = framer.next_frame().expect("every frame decodes") {
        let id = frame.value["__id"].as_str().expect("id is a string");
        ids.push(id.to_string());
    }
    assert_eq!(ids, ["first".to_string(), "second".to_string()]);
}

#[test]
fn a_malformed_frame_is_dropped_and_never_answered() {
    let mut framer = framer_holding(b"{\"__id\": \"abc\",\r\n");

    assert_eq!(drop_reason(&mut framer), FrameError::NotJson);
    // The same frame stays undeliverable: a frame the codec cannot read never
    // turns into a reply, and never into a refusal the caller could answer.
    assert_eq!(drop_reason(&mut framer), FrameError::NotJson);
}

#[test]
fn a_frame_that_is_not_utf8_is_dropped() {
    let mut framer = framer_holding(&[b'{', 0xff, 0xfe, b'}', b'\r', b'\n']);

    assert_eq!(drop_reason(&mut framer), FrameError::NotJson);
}

#[test]
fn a_frame_that_is_not_an_object_is_dropped() {
    let mut framer = framer_holding(b"[1, 2, 3]\r\n");

    assert_eq!(drop_reason(&mut framer), FrameError::NotAnObject);
}

#[test]
fn a_bare_line_feed_is_not_a_frame() {
    let mut framer = framer_holding(b"{\"__id\": \"abc\"}\n");

    assert_eq!(drop_reason(&mut framer), FrameError::Unterminated);
}

#[test]
fn a_read_that_cannot_become_a_legal_frame_is_refused() {
    let mut framer = Framer::default();
    let endless = vec![b'x'; MAX_MESSAGE_SIZE];

    assert!(matches!(
        framer
            .push(&endless)
            .expect_err("a message this size is not framed"),
        FrameError::TooLarge(_)
    ));
    assert_eq!(
        drop_reason(&mut framer),
        FrameError::TooLarge(EnvelopeError::MessageTooLarge {
            size: MAX_MESSAGE_SIZE + 1,
            limit: MAX_MESSAGE_SIZE,
        })
    );
}

#[test]
fn data_that_is_not_an_object_is_refused_but_still_answerable() {
    let mut framer =
        framer_holding(b"{\"__id\": \"abc\", \"__method\": \"echo\", \"__data\": 7}\r\n");

    let frame = only_frame(&mut framer);
    assert_eq!(frame.refusal, Some(FrameRefusal::DataNotAnObject));
    // The envelope is intact, so the dispatcher still has the id it needs to
    // key the error envelope with.
    assert_eq!(frame.value["__id"], json!("abc"));
    assert!(framer.next_frame().expect("connection continues").is_none());
}

#[test]
fn an_absent_data_key_is_left_for_the_envelope_layer() {
    let mut framer = framer_holding(b"{\"__id\": \"abc\", \"__method\": \"echo\"}\r\n");

    assert_eq!(only_frame(&mut framer).refusal, None);
}

#[test]
fn a_refused_outgoing_message_leaves_the_connection_usable() {
    let oversized = request_of_size(OVERSIZE_PAYLOAD);
    assert!(encode(&oversized).is_err());

    let wire = encode(&request("abc", "echo", Value::Null)).expect("next message frames");
    let mut framer = framer_holding(&wire);
    assert!(framer.next_frame().expect("next message decodes").is_some());
}
