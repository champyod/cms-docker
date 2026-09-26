//! CRLF framing for one connection: one read buffer, one parse per frame.
//!
//! `src/cms/io/rpc.py` frames every message as its payload followed by `\r\n`,
//! drops a message that does not fit the limit, and answers nothing it could
//! not read. Those decisions live here so a transport stays a thin loop:
//! absorb what was read, take whole frames out of the buffer, write what
//! [`encode`] produced.
//!
//! The buffer belongs to the connection rather than to the frame, so a message
//! costs one copy into capacity that already exists instead of a fresh
//! allocation per message. The limit in [`crate::guards`] is what keeps that
//! buffer from growing without bound.

use serde::Serialize;
use serde_json::Value;

use crate::guards::{ensure_within_size_limit, EnvelopeError};

/// Carriage return, the first byte of the terminator.
const CARRIAGE_RETURN: u8 = b'\r';

/// Line feed, the byte a frame ends on.
const LINE_FEED: u8 = b'\n';

/// Terminator the transport appends to every message.
const TERMINATOR: &[u8] = &[CARRIAGE_RETURN, LINE_FEED];

/// Key the Python transport splats into the remote call.
const DATA_KEY: &str = "__data";

/// One complete frame: the parsed envelope and the reason it may not run.
#[derive(Debug)]
pub struct Frame {
    /// Bytes the envelope occupied, terminator excluded.
    pub payload_len: usize,

    /// The envelope as JSON. Always an object, because a frame that decodes to
    /// anything else has no `__id` to key a reply with.
    pub value: Value,

    /// Why this envelope must not be dispatched, when it can still be
    /// answered.
    pub refusal: Option<FrameRefusal>,
}

/// Why a frame ended the connection instead of producing a reply.
///
/// A frame reported here is dropped without a response, exactly as
/// `process_data` and `_read` drop one: what the codec could not read has no
/// envelope to answer with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FrameError {
    /// The framed message would exceed the limit. Carries the guard's own
    /// error so the refusal reads the same wherever it is reported.
    TooLarge(EnvelopeError),

    /// The payload is not JSON: on the way in it did not decode, on the way
    /// out it does not encode. A JSON document is UTF-8, so bytes that are not
    /// UTF-8 are not JSON either.
    NotJson,

    /// The frame decoded to something other than an object.
    NotAnObject,

    /// The frame ended on a bare line feed; the transport frames with CRLF.
    Unterminated,
}

/// Why a well-formed frame must not be dispatched.
///
/// The one refusal here is answered rather than dropped, so it is kept apart
/// from [`FrameError`]: a frame the dispatcher refuses still has an `__id` to
/// answer, and the error envelope that carries the reason is the dispatcher's
/// to build.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameRefusal {
    /// `__data` is present but is not an object, so there are no keyword
    /// arguments to call the method with.
    DataNotAnObject,
}

/// Frames one connection's reads: absorbs bytes, hands back whole frames.
///
/// One instance per connection. It never allocates per frame and it is
/// finished once it reports an error.
#[derive(Debug, Default)]
pub struct Framer {
    /// Bytes read but not yet decoded. Everything before `start` is consumed.
    buffer: Vec<u8>,

    /// Offset of the first undecoded byte.
    start: usize,

    /// Offset into `buffer` where the search for a terminator resumes.
    ///
    /// Everything from `start` up to `scan` is already known to hold no line
    /// feed, so `start <= scan <= buffer.len()` holds at every observable
    /// point and a frame that arrives one chunk at a time is scanned once in
    /// total rather than once per chunk. [`Self::consume_through`] is the only
    /// thing that moves it.
    scan: usize,
}

impl Framer {
    /// Absorbs a chunk read from the connection.
    ///
    /// # Errors
    ///
    /// [`FrameError::TooLarge`] once the undecoded bytes can no longer become a
    /// legal frame, so a message the limit exists to stop stops costing memory.
    pub fn push(&mut self, chunk: &[u8]) -> Result<(), FrameError> {
        self.buffer.extend_from_slice(chunk);
        if self.line_feed_offset().is_some() {
            return Ok(());
        }
        self.check_frameable()
    }

    /// Decodes the next complete frame, if one is buffered.
    ///
    /// Each call parses at most one frame, so a chunk carrying several frames
    /// is drained by calling this until it reports nothing left.
    ///
    /// # Errors
    ///
    /// [`FrameError`] when the buffered frame is one to drop without answering:
    /// too large, not JSON, not an object, or unterminated. The framer holds no
    /// usable state after an error.
    pub fn next_frame(&mut self) -> Result<Option<Frame>, FrameError> {
        let Some(line_feed) = self.line_feed_offset() else {
            self.check_frameable()?;
            return Ok(None);
        };
        if line_feed == 0 || self.pending()[line_feed - 1] != CARRIAGE_RETURN {
            return Err(FrameError::Unterminated);
        }
        let payload_len = line_feed - 1;
        ensure_within_size_limit(payload_len).map_err(FrameError::TooLarge)?;
        let frame = self.decode(payload_len)?;
        self.consume_through(line_feed + 1);
        Ok(Some(frame))
    }

    /// Refuses a read whose undecoded bytes can no longer become a legal frame.
    fn check_frameable(&self) -> Result<(), FrameError> {
        // WHY: the carriage return may already be buffered, so a frame that
        // could still be legal holds one byte more than a legal payload may.
        ensure_within_size_limit(self.pending_len().saturating_sub(1)).map_err(FrameError::TooLarge)
    }

    /// Turns one buffered payload into a frame.
    fn decode(&self, payload_len: usize) -> Result<Frame, FrameError> {
        let payload = &self.pending()[..payload_len];
        let value: Value = serde_json::from_slice(payload).map_err(|_| FrameError::NotJson)?;
        if !value.is_object() {
            return Err(FrameError::NotAnObject);
        }
        let refusal = refusal_of(&value);
        Ok(Frame {
            payload_len,
            value,
            refusal,
        })
    }

    /// Drops the decoded prefix once it outweighs the rest.
    ///
    /// Compacting on every frame would copy the remainder once per frame; doing
    /// it only past the halfway point keeps the buffer from holding a frame's
    /// worth of dead bytes for the life of the connection.
    fn consume_through(&mut self, end: usize) {
        self.start += end;
        // WHY: the region just consumed ended on a line feed and held none
        // before it, so resuming the scan at the new `start` can neither miss
        // a terminator nor look at a byte twice.
        self.scan = self.start;
        if self.start < self.pending_len() {
            return;
        }
        self.buffer.drain(..self.start);
        self.start = 0;
        self.scan = 0;
    }

    /// Offset of the first undecoded line feed, relative to `start`.
    ///
    /// Resumes at `scan` rather than at the first undecoded byte, and leaves
    /// `scan` on the line feed it found so a caller that reads the same frame
    /// twice is answered the same way both times.
    fn line_feed_offset(&mut self) -> Option<usize> {
        let line_feed = self.buffer[self.scan..]
            .iter()
            .position(|byte| *byte == LINE_FEED)
            .map(|offset| self.scan + offset);
        self.scan = line_feed.unwrap_or(self.buffer.len());
        line_feed.map(|found| found - self.start)
    }

    /// Bytes read but not yet decoded.
    fn pending(&self) -> &[u8] {
        &self.buffer[self.start..]
    }

    /// How many of those bytes there are.
    const fn pending_len(&self) -> usize {
        self.buffer.len() - self.start
    }
}

/// Frames an envelope for the wire, terminator included.
///
/// # Errors
///
/// [`FrameError::TooLarge`] when the encoded envelope plus its terminator would
/// exceed [`crate::MAX_MESSAGE_SIZE`], and [`FrameError::NotJson`] when the
/// value does not encode. Both are decided before anything is written, so the
/// connection stays open and the caller reports the refusal to its own caller.
pub fn encode(envelope: &impl Serialize) -> Result<Vec<u8>, FrameError> {
    let mut framed = serde_json::to_vec(envelope).map_err(|_| FrameError::NotJson)?;
    ensure_within_size_limit(framed.len()).map_err(FrameError::TooLarge)?;
    framed.extend_from_slice(TERMINATOR);
    Ok(framed)
}

/// Reports the refusal that still ends in a reply.
///
/// A missing `__data` is not one of them: `rpc.py` drops that frame earlier, on
/// its missing-key check, and only decoding a `Request` can tell the two apart.
fn refusal_of(value: &Value) -> Option<FrameRefusal> {
    value
        .get(DATA_KEY)
        .and_then(|data| (!data.is_object()).then_some(FrameRefusal::DataNotAnObject))
}
