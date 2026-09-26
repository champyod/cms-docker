//! Refusal rules every RPC handler must apply before acting on an envelope.
//!
//! Each rule mirrors a check that already exists in `src/cms/io/rpc.py`, so a
//! Rust service refuses exactly what the Python service refuses — and refuses
//! it with a message the Python client can read. The two sides therefore stay
//! interchangeable without either one growing a new failure mode.

use std::fmt;

/// Largest message accepted on the wire, terminator included.
///
/// Mirrors `RemoteServiceBase.MAX_MESSAGE_SIZE`; the Python side drops a
/// message that exceeds it instead of buffering it.
pub const MAX_MESSAGE_SIZE: usize = 1024 * 1024;

/// Bytes the Python transport appends to frame a message.
///
/// `_write` measures the payload together with this terminator, so the guard
/// below has to add it too or a Rust service would accept one message more
/// than a Python service.
pub const MESSAGE_TERMINATOR_LEN: usize = 2;

/// Why an envelope was refused, phrased for the handler that has to report it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EnvelopeError {
    /// `__id` was present but empty, so a response could not be correlated.
    EmptyId,
    /// `__method` was present but empty, so there is nothing to dispatch to.
    EmptyMethod,
    /// The framed message would exceed [`MAX_MESSAGE_SIZE`].
    MessageTooLarge {
        /// Size of the payload plus its terminator.
        size: usize,
        /// The limit that was exceeded.
        limit: usize,
    },
    /// The presented secret is absent, empty, or does not match the configured
    /// one. Deliberately says nothing about which of those it was.
    AuthenticationFailed,
}

impl fmt::Display for EnvelopeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyId => write!(f, "envelope rejected: `__id` must not be empty"),
            Self::EmptyMethod => write!(f, "envelope rejected: `__method` must not be empty"),
            Self::MessageTooLarge { size, limit } => {
                write!(f, "message of {size} bytes exceeds the {limit} byte limit")
            }
            // WHY: byte-identical to the string `process_incoming_request`
            // puts on the wire, so a Python caller recognises the refusal.
            Self::AuthenticationFailed => write!(f, "RPC authentication failed."),
        }
    }
}

impl std::error::Error for EnvelopeError {}

/// Reports whether a presented secret authenticates against the configured one.
///
/// Fails closed exactly like `_check_rpc_secret`: an unconfigured secret never
/// authenticates anybody, so a service that forgot to configure one rejects all
/// calls instead of silently accepting them.
#[must_use]
pub fn check_rpc_secret(presented: Option<&str>, configured: Option<&str>) -> bool {
    let (Some(presented), Some(configured)) = (presented, configured) else {
        return false;
    };
    if presented.is_empty() || configured.is_empty() {
        return false;
    }
    constant_time_eq(presented.as_bytes(), configured.as_bytes())
}

/// Rejects a payload that would not fit in a single message.
///
/// `payload_len` is the serialized envelope; the terminator the transport adds
/// counts against the limit, matching the `_write` guard in `rpc.py`.
pub fn ensure_within_size_limit(payload_len: usize) -> Result<(), EnvelopeError> {
    let limit = MAX_MESSAGE_SIZE;
    let size = payload_len.saturating_add(MESSAGE_TERMINATOR_LEN);
    if size > limit {
        return Err(EnvelopeError::MessageTooLarge { size, limit });
    }
    Ok(())
}

/// Compares two byte strings without leaking where they first differ.
///
/// The loop always runs over the full input and the length verdict is folded
/// in afterwards, so a mismatch costs the same time as a match. The length of
/// each input is public information (the sender chose one of them), which is why
/// only the contents are hidden.
fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    let mut content_diff = 0_u8;
    for (left_byte, right_byte) in left.iter().zip(right) {
        content_diff |= left_byte ^ right_byte;
    }
    content_diff == 0 && left.len() == right.len()
}
