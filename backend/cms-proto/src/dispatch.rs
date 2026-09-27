//! The one gate a decoded message passes, in the order `rpc.py` passes it.
//!
//! `RemoteServiceBase.process_incoming_request` decides an incoming message in
//! six steps and writes its own answer at three points in the function, so a
//! handler that repeats the checks by hand is a handler that will eventually
//! repeat them in another order — and the order is the security property, not
//! an implementation detail. An unauthenticated caller is refused before the
//! method it named is read, so it learns nothing about which methods the
//! service has. The backdoor gate runs after authentication and before the
//! lookup, so a caller refused for it has already proven it knows the secret,
//! and a caller refused for any other reason is never told the backdoor is
//! there at all.
//!
//! [`dispatch`] therefore performs the whole sequence in one place and reports
//! what the transport owes the wire: nothing at all for a message that cannot
//! be correlated, or one complete [`Response`] carrying either the refusal or
//! the result. Every refusal reuses the exact string `rpc.py` writes, so a
//! Python caller reads a Rust refusal as the refusal it would have read from a
//! Python service.

use std::borrow::Cow;

use serde_json::{Map, Value};

use crate::guards::{check_rpc_secret, EnvelopeError};
use crate::{error, ok, Response};

/// Key of the id a reply is correlated with.
const ID_KEY: &str = "__id";

/// Key of the name of the method to run.
const METHOD_KEY: &str = "__method";

/// Key of the keyword arguments the method is called with.
const DATA_KEY: &str = "__data";

/// Key of the shared secret, absent when the caller has none to present.
const SECRET_KEY: &str = "__secret";

/// The methods that open a shell on the host, refused unless the service opted in.
///
/// A remote backdoor is a shell, so it is gated behind its own setting even for
/// a caller that already presented the right secret.
const BACKDOOR_METHODS: [&str; 2] = ["start_backdoor", "stop_backdoor"];

/// The answer for a backdoor method on a service that did not opt in.
///
/// Byte-identical to the string `process_incoming_request` writes, so a client
/// that enabled nothing is told the same thing by either implementation.
const BACKDOOR_REFUSED: &str = "Backdoor RPC is disabled.";

/// One method a service puts on the wire, and whether a remote caller may call it.
///
/// The table these are listed in *is* the allowlist. A name absent from it does
/// not exist as far as the wire is concerned, and a name present with
/// [`is_callable`](Self::is_callable) cleared does exist but is refused, which
/// is the difference `rpc.py` draws between `hasattr` and the `rpc_callable`
/// attribute its `rpc_method` decorator sets.
#[derive(Debug, Clone, Copy)]
pub struct Method {
    /// The name as it travels under `__method`, matched exactly.
    pub name: &'static str,
    /// Whether another service may reach the method once every gate has passed.
    pub is_callable: bool,
    /// What runs then: the `__data` object as arguments, and either the value
    /// to answer with or the message to answer it with instead.
    pub handler: fn(&Value) -> Result<Value, String>,
}

/// The two settings a gate is allowed to decide with.
///
/// Both are passed in rather than read from anywhere global, so what a service
/// refuses is a property of the service instead of of the process it happens to
/// run in — and a test can refuse a backdoor without starting one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GateConfig<'a> {
    /// The secret presented secrets are compared against. `None` is a service
    /// that configured none, which authenticates nobody.
    pub secret: Option<&'a str>,
    /// Whether this service opted in to the backdoor methods.
    pub is_backdoor_enabled: bool,
}

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
#[derive(Debug, Clone, PartialEq)]
pub enum Decision {
    /// Write nothing at all: the message is dropped and the connection ends.
    Dropped(DropReason),
    /// Write this response, which carries either the refusal or the result.
    Answered(Response),
}

/// Runs one decoded message through every gate, in the order `rpc.py` runs them.
///
/// The sequence is fixed and the gates are not interchangeable:
///
/// 1. the three required keys, and a message missing one is dropped unanswered;
/// 2. the secret, refused with the string `rpc.py` refuses with;
/// 3. the backdoor opt-in, for a method that opens a shell and a service that
///    did not opt in, refused with that refusal even though the secret was right;
/// 4. the method name, refused as not existing when no entry in `methods` names it;
/// 5. that entry's [`is_callable`](Method::is_callable), refused as not callable;
/// 6. the handler, and only then.
///
/// Nothing after step 3 runs unless steps 1 to 3 passed, so an unauthenticated
/// or backdoor-refused caller cannot reach a handler and cannot tell an
/// existing name from one that is not.
#[must_use]
pub fn dispatch(envelope: &Value, methods: &[Method], config: &GateConfig<'_>) -> Decision {
    let Some(object) = envelope.as_object() else {
        return Decision::Dropped(DropReason::NotAnObject);
    };
    let message = match read(object) {
        Ok(message) => message,
        Err(reason) => return Decision::Dropped(reason),
    };
    if !check_rpc_secret(message.secret, config.secret) {
        return refusal(message.id, EnvelopeError::AuthenticationFailed.to_string());
    }
    if opens_backdoor(message.method) && !config.is_backdoor_enabled {
        return refusal(message.id, BACKDOOR_REFUSED);
    }
    match message
        .method
        .as_str()
        .and_then(|name| lookup(methods, name))
    {
        None => refusal(message.id, method_missing(message.method)),
        Some(entry) if !entry.is_callable => refusal(message.id, method_uncallable(message.method)),
        Some(entry) => call(entry, &message),
    }
}

/// The four keys the gate reads, taken off a message that carries them.
struct Envelope<'a> {
    /// The id a reply is correlated with.
    id: &'a str,
    /// The method the message named, still raw: a value that is not a string
    /// names no entry, and a refusal has to show what actually arrived.
    method: &'a Value,
    /// The keyword arguments the method would be called with.
    data: &'a Value,
    /// The presented secret, absent when its key is or when it is not a string.
    secret: Option<&'a str>,
}

/// Reads the keys every gate needs off a decoded message.
///
/// # Errors
///
/// [`DropReason::MissingKey`] naming the first of `__id`, `__method` and
/// `__data` that is absent, and [`DropReason::IdNotAString`] when `__id` is
/// present but is not a string. A `__secret` that is present but is not a
/// string reads as absent, which authenticates the message against nothing and
/// is refused like any other failed authentication.
fn read(object: &Map<String, Value>) -> Result<Envelope<'_>, DropReason> {
    let id = object.get(ID_KEY).ok_or(DropReason::MissingKey(ID_KEY))?;
    let method = object
        .get(METHOD_KEY)
        .ok_or(DropReason::MissingKey(METHOD_KEY))?;
    let data = object
        .get(DATA_KEY)
        .ok_or(DropReason::MissingKey(DATA_KEY))?;
    Ok(Envelope {
        id: id.as_str().ok_or(DropReason::IdNotAString)?,
        method,
        data,
        secret: object.get(SECRET_KEY).and_then(Value::as_str),
    })
}

/// Runs the one method every gate let through and reports what it produced.
///
/// The `__data` is handed over exactly as it arrived: a `__data` that is not an
/// object is already refused by [`crate::FrameRefusal`], and the handler is
/// where a call that cannot be made reports it, as the splat of the Python side
/// does. The handler's own message becomes the `__error` verbatim, because
/// `rpc.py` formats an exception with its class and a traceback, which a handler
/// in another language has no honest way to reproduce.
fn call(entry: &Method, message: &Envelope<'_>) -> Decision {
    match (entry.handler)(message.data) {
        Ok(result) => Decision::Answered(ok(message.id, result)),
        Err(failure) => refusal(message.id, failure),
    }
}

/// The answer to a message that must not be dispatched, keyed with its id.
fn refusal(id: &str, reason: impl Into<String>) -> Decision {
    Decision::Answered(error(id, reason))
}

/// Finds the entry a method name reaches, by exact name.
fn lookup<'a>(methods: &'a [Method], name: &str) -> Option<&'a Method> {
    methods.iter().find(|entry| entry.name == name)
}

/// Reports whether the call would open a shell on the host.
///
/// A `__method` that is not a string names no backdoor, and falls through to the
/// existence check, which refuses it for the more basic reason it has.
fn opens_backdoor(method: &Value) -> bool {
    method
        .as_str()
        .is_some_and(|name| BACKDOOR_METHODS.contains(&name))
}

/// The refusal for a name the service does not expose at all.
fn method_missing(method: &Value) -> String {
    format!("Method {} doesn't exist.", name_of(method))
}

/// The refusal for a name the service exposes without letting others call it.
fn method_uncallable(method: &Value) -> String {
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
