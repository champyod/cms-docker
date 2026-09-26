//! Refusal rules every RPC handler must apply before acting on an envelope.
//!
//! Each rule mirrors a check that already exists in `src/cms/io/rpc.py`, so a
//! Rust service refuses exactly what the Python service refuses — and refuses
//! it with a message the Python client can read. The two sides therefore stay
//! interchangeable without either one growing a new failure mode.

use std::fmt;

use subtle::ConstantTimeEq;

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
///
/// A non-ASCII secret is the one place this deliberately parts company with
/// `_check_rpc_secret`, which hands both sides to `hmac.compare_digest` and so
/// raises `TypeError` on a non-ASCII `str`. That call sits outside every
/// handler in `process_incoming_request`, so the greenlet serving the request
/// dies without writing a reply, the caller's pending result is never
/// resolved, and the caller waits. Comparing the UTF-8 bytes here turns the
/// same envelope into an ordinary mismatch answered with
/// [`EnvelopeError::AuthenticationFailed`], so the comparison stays byte-wise
/// and a non-ASCII secret is never diverted into a path that skips the reply.
///
/// The contents are compared in constant time, so a mismatch costs what a
/// match costs. The length is not hidden: the sender chose it, and a length
/// difference settles the comparison on its own.
#[must_use]
pub fn check_rpc_secret(presented: Option<&str>, configured: Option<&str>) -> bool {
    let (Some(presented), Some(configured)) = (presented, configured) else {
        return false;
    };
    if presented.is_empty() || configured.is_empty() {
        return false;
    }
    bool::from(presented.as_bytes().ct_eq(configured.as_bytes()))
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
