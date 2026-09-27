//! What the gate writes back: the refusal for a message it will not dispatch,
//! and the answer for one it will.
//!
//! The refusal strings are pinned here rather than in [`crate::dispatch`] so a
//! refusal is written once beside the decision it reports, and so the gate reads
//! as a sequence of checks with no wire text interleaved between them.

use std::borrow::Cow;

use serde_json::Value;

use super::gate::{Envelope, Method};
use crate::{error, ok, Response};

/// The answer for a backdoor method on a service that did not opt in.
///
/// Byte-identical to the string `process_incoming_request` writes, so a client
/// that enabled nothing is told the same thing by either implementation.
pub(super) const BACKDOOR_REFUSED: &str = "Backdoor RPC is disabled.";

/// Why a message is dropped instead of answered.
///
/// Every case here is a message with no `__id` a reply could be correlated
/// with, or with one the two sides would not agree on: `rpc.py` disconnects on
/// the first without answering, and a reply keyed with a differently-typed `__id`
/// is not the reply the caller is still waiting for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DropReason {
    /// The message is not a JSON object, so it has no keys to check and no id.
    NotAnObject,
    /// One of the three keys `process_incoming_request` tests for is absent.
    /// Carries the first one that is, in the order they are read, so the same
    /// message is always reported the same way.
    MissingKey(&'static str),
    /// `__id` is present but is not a string, so a reply could not be keyed
    /// with what the caller sent.
    IdNotAString,
}

/// What the gate decided about one decoded message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision {
    /// Write nothing at all: the message is dropped and the connection ends.
    Dropped(DropReason),
    /// Write this response, which carries either the refusal or the result.
    Answered(Response),
}

/// Runs the one method every gate let through and reports what it produced.
///
/// The `__data` is handed over exactly as it arrived: a `__data` that is not an
/// object is already refused by [`crate::FrameRefusal`], and the handler is
/// where a call that cannot be made reports it, as the splat of the Python side
/// does. The handler's own message becomes the `__error` verbatim, because
/// `rpc.py` formats an exception with its class and a traceback, which a handler
/// in another language has no honest way to reproduce.
pub(super) fn call(entry: &Method, message: &Envelope<'_>) -> Decision {
    match (entry.handler)(message.data) {
        Ok(result) => Decision::Answered(ok(message.id, result)),
        Err(failure) => refusal(message.id, failure),
    }
}

/// The answer to a message that must not be dispatched, keyed with its id.
pub(super) fn refusal(id: &str, reason: impl Into<String>) -> Decision {
    Decision::Answered(error(id, reason))
}

/// The refusal for a name the service does not expose at all.
pub(super) fn method_missing(method: &Value) -> String {
    format!("Method {} doesn't exist.", name_of(method))
}

/// The refusal for a name the service exposes without letting others call it.
pub(super) fn method_uncallable(method: &Value) -> String {
    format!("Method {} isn't callable.", name_of(method))
}

/// Renders the `__method` a refusal names.
///
/// A name is shown exactly as it arrived. A value that is not a string names no
/// entry, so it is shown as the JSON the caller sent: the refusal then says
/// what was asked for without pretending it was a name.
fn name_of(method: &Value) -> Cow<'_, str> {
    match method {
        Value::String(name) => Cow::Borrowed(name.as_str()),
        other => Cow::Owned(other.to_string()),
    }
}
