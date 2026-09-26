//! JSON envelope types for the CMS RPC protocol.
//!
//! These structs mirror the JSON dictionaries that `src/cms/io/rpc.py`
//! exchanges over the wire, so a Rust service and a Python service can
//! decode each other's messages without a translation layer. Field names
//! are the double-underscore names the Python side checks verbatim; any
//! mismatch there is a protocol break, not a style issue. Payloads are
//! opaque `serde_json::Value` because the Python side never inspects
//! `__data` inside the envelope layer.
//!
//! Decoding is deliberately the only strict step: the types reproduce the
//! wire shape, and every judgement call about whether a well-formed envelope
//! may be acted on is written down in one place per subject — [`Request::validate`],
//! [`Request::authenticate`] and [`Response::validate`] for the envelope
//! itself, [`guards`] for the frame that carries it. Each states the Python
//! rule it mirrors.
//!
//! A connection's frame codec owns one read buffer for the whole connection
//! and decodes successive frames out of it, so a message costs a copy into
//! existing capacity rather than a fresh allocation per frame. The message
//! limit in [`guards`] is what keeps that buffer from growing without bound.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

mod codec;
mod guards;
mod jobs;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fmt;

pub use codec::{encode, Frame, FrameError, FrameRefusal, Framer};
pub use guards::{
    check_rpc_secret, ensure_within_size_limit, EnvelopeError, MAX_MESSAGE_SIZE,
    MESSAGE_TERMINATOR_LEN,
};
pub use jobs::{
    JobGroup, QueueEntryDto, QueueKey, PRIORITY_EXTRA_HIGH, PRIORITY_EXTRA_LOW, PRIORITY_HIGH,
    PRIORITY_LOW, PRIORITY_MEDIUM,
};

/// Shown in place of the secret wherever a `Request` is formatted.
const SECRET_REDACTED: &str = "<redacted>";

/// Outgoing call: method name plus arguments, tagged with a unique id.
#[derive(Clone, PartialEq, Serialize, Deserialize)]
pub struct Request {
    /// Correlation id, echoed back by the responder.
    #[serde(rename = "__id")]
    pub id: String,

    /// Name of the remote method to invoke.
    #[serde(rename = "__method")]
    pub method: String,

    /// Keyword arguments for the method, opaque to the envelope layer.
    #[serde(rename = "__data")]
    pub data: Value,

    /// The Python client omits this key entirely when no secret is
    /// configured, so it must be optional rather than an empty string.
    ///
    /// A secret that is not a string is refused while decoding, where the
    /// Python side would have refused it at authentication; both refuse it,
    /// and only a hand-written caller can produce one.
    #[serde(rename = "__secret", skip_serializing_if = "Option::is_none")]
    pub secret: Option<String>,
}

/// Formats a request without its secret.
///
/// `rpc.py` never logs the secret, so a derived `Debug` here would make a log
/// line or a panic message the one place it is written down in the clear.
impl fmt::Debug for Request {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Request")
            .field("id", &self.id)
            .field("method", &self.method)
            .field("data", &self.data)
            .field("secret", &self.secret.as_ref().map(|_| SECRET_REDACTED))
            .finish()
    }
}

impl Request {
    /// Refuses an envelope that is well-formed but not dispatchable.
    ///
    /// `rpc.py` only requires the three keys to be present; this additionally
    /// rejects empty `__id` and `__method`, which its own client can never
    /// produce (a `uuid4().hex` and a Python attribute name). Being stricter
    /// on the receiving side cannot change what a Python caller may send, so it
    /// closes a hole without moving the protocol.
    ///
    /// # Errors
    ///
    /// Returns [`EnvelopeError::EmptyId`] or [`EnvelopeError::EmptyMethod`]
    /// when the corresponding field is empty.
    pub fn validate(&self) -> Result<(), EnvelopeError> {
        if self.id.is_empty() {
            return Err(EnvelopeError::EmptyId);
        }
        if self.method.is_empty() {
            return Err(EnvelopeError::EmptyMethod);
        }
        Ok(())
    }

    /// Authenticates the request against the configured secret.
    ///
    /// # Errors
    ///
    /// Returns [`EnvelopeError::AuthenticationFailed`] whenever the secret is
    /// absent, empty or different — the three cases stay indistinguishable so
    /// the answer cannot be used as an oracle.
    pub fn authenticate(&self, configured: Option<&str>) -> Result<(), EnvelopeError> {
        if check_rpc_secret(self.secret.as_deref(), configured) {
            Ok(())
        } else {
            Err(EnvelopeError::AuthenticationFailed)
        }
    }
}

/// Reply to a call: the echoed id, the result, and a null when no error.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Response {
    /// Correlation id copied verbatim from the request.
    #[serde(rename = "__id")]
    pub id: String,

    /// Method result, or null when the call failed.
    #[serde(rename = "__data")]
    pub data: Value,

    /// Failure detail, or null when the call succeeded.
    ///
    /// Required on decode, null included: `process_incoming_response`
    /// disconnects a reply whose keys do not cover `__error` and then reads
    /// that key unconditionally, so a reply that omits it is a broken
    /// response rather than a successful one. Always serialized for the same
    /// reason — a client must never be the side that finds a key missing.
    #[serde(rename = "__error", deserialize_with = "Option::<Value>::deserialize")]
    pub error: Option<Value>,
}

impl Response {
    /// Refuses a reply that could not be correlated with its request.
    ///
    /// # Errors
    ///
    /// Returns [`EnvelopeError::EmptyId`] when the echoed id is empty.
    pub fn validate(&self) -> Result<(), EnvelopeError> {
        if self.id.is_empty() {
            return Err(EnvelopeError::EmptyId);
        }
        Ok(())
    }
}

/// Convenience constructor: a request without authentication secret.
#[must_use]
pub fn request(id: impl Into<String>, method: impl Into<String>, data: Value) -> Request {
    Request {
        id: id.into(),
        method: method.into(),
        data,
        secret: None,
    }
}

/// Convenience constructor: a success response (error serialized as null).
#[must_use]
pub fn ok(id: impl Into<String>, data: Value) -> Response {
    Response {
        id: id.into(),
        data,
        error: None,
    }
}

/// Convenience constructor: an error response with the message string.
#[must_use]
pub fn error(id: impl Into<String>, message: impl Into<String>) -> Response {
    Response {
        id: id.into(),
        data: Value::Null,
        error: Some(Value::String(message.into())),
    }
}
