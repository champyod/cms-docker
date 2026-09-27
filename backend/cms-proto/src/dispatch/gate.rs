//! The gates themselves, run in the order `rpc.py` runs them.
//!
//! The whole sequence is one function because the order *is* the property: a
//! reader has to be able to walk it against `process_incoming_request` line by
//! line, and splitting the checks across helpers is how two of them end up
//! running in the other order later.

use serde_json::{Map, Value};

use super::answer::{
    call, method_missing, method_uncallable, refusal, Decision, DropReason, BACKDOOR_REFUSED,
};
use crate::guards::{check_rpc_secret, EnvelopeError};

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

/// Runs one decoded message through every gate, in the order the module
/// documents.
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
pub(super) struct Envelope<'a> {
    /// The id a reply is correlated with.
    pub(super) id: &'a str,
    /// The method the message named, still raw: a value that is not a string
    /// names no entry, and a refusal has to show what actually arrived.
    pub(super) method: &'a Value,
    /// The keyword arguments the method would be called with.
    pub(super) data: &'a Value,
    /// The presented secret, absent when its key is or when it is not a string.
    pub(super) secret: Option<&'a str>,
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
