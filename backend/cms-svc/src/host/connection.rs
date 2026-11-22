//! One connection's loop: read, frame, dispatch, answer, and stop on a drop.

use std::io::{ErrorKind, Read, Write};
use std::net::TcpStream;

use cms_proto::{encode, Frame, Framer, Response};

use super::Registry;
use crate::{of_dispatch, of_frame, Send};

/// Bytes asked of the socket per read, so a whole call usually arrives at once.
const READ_CHUNK: usize = 8 * 1024;

/// Whether the connection has anything left to do after one step.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Flow {
    Continue,
    Close,
}

/// Serves one connection until the peer closes it or a message ends it.
pub(super) fn serve(mut stream: TcpStream, registry: &Registry) {
    let mut framer = Framer::default();
    let mut chunk = [0_u8; READ_CHUNK];
    loop {
        let read = match stream.read(&mut chunk) {
            Ok(0) => return,
            Ok(read) => read,
            Err(error) if error.kind() == ErrorKind::Interrupted => continue,
            Err(_) => return,
        };
        if converse(&mut stream, &mut framer, &chunk[..read], registry) == Flow::Close {
            return;
        }
    }
}

/// Absorbs one read, then answers every frame it completed.
///
/// The framer keeps a partial message between calls because a frame may arrive
/// across two reads, and a read that can no longer become a legal frame ends
/// the connection with nothing written, which is what the codec refuses for.
fn converse(
    stream: &mut TcpStream,
    framer: &mut Framer,
    chunk: &[u8],
    registry: &Registry,
) -> Flow {
    if framer.push(chunk).is_err() {
        return Flow::Close;
    }
    drain(stream, framer, registry)
}

/// Answers buffered frames until one is incomplete or one ends the connection.
fn drain(stream: &mut TcpStream, framer: &mut Framer, registry: &Registry) -> Flow {
    loop {
        let frame = match framer.next_frame() {
            Ok(Some(frame)) => frame,
            Ok(None) => return Flow::Continue,
            Err(_) => return Flow::Close,
        };
        if answer(stream, registry, &frame) == Flow::Close {
            return Flow::Close;
        }
    }
}

/// Writes what one frame is owed.
fn answer(stream: &mut TcpStream, registry: &Registry, frame: &Frame) -> Flow {
    // WHY: the codec refuses a `__data` that is not an object before the gate,
    // so a handler is never handed arguments it cannot splat.
    let send = match frame.refusal {
        Some(_) => of_frame(&frame.value),
        None => of_dispatch(&registry.decide(&frame.value)),
    };
    match send {
        Send::Dropped => Flow::Close,
        Send::Answer(response) => write(stream, &response),
    }
}

/// Writes one answer, ending the connection when it cannot be framed or sent.
fn write(stream: &mut TcpStream, response: &Response) -> Flow {
    let Ok(framed) = encode(response) else {
        // WHY: an answer that cannot be framed leaves the caller waiting on an
        // id that will never arrive, so the connection ends instead.
        return Flow::Close;
    };
    if stream.write_all(&framed).is_ok() {
        Flow::Continue
    } else {
        Flow::Close
    }
}
