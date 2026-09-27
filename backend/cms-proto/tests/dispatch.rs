//! The order the composed gate applies, and the exact refusal each order produces.
//!
//! A decision is the gate's only output, so a refusal that comes back with a
//! null `__data` is itself the proof that no handler ran: the handlers here
//! answer with a value of their own, so a dispatched one would have put it
//! there. That keeps the tests pure — no counters, no locks, nothing shared
//! between them — and every assertion is a whole response, so the correlation
//! id, the absent result and the exact error are checked together.
//!
//! Every error string below is the one `process_incoming_request` writes,
//! character for character. A refusal edited on this side without the Python
//! side being edited fails here rather than in a caller.

use cms_proto::{dispatch, ok, Decision, DropReason, GateConfig, Method, Response};
use serde_json::{json, Value};

/// The correlation id every message here carries.
const REQUEST: &str = "req-1";

/// The secret the service under test is configured with.
const SECRET: &str = "correct-horse-battery-staple";

/// A service exposing two callable methods, one that fails, two backdoor
/// methods, and one that exists without being callable.
const SERVICE: [Method; 5] = [
    Method {
        name: "get_status",
        is_callable: true,
        handler: echo,
    },
    Method {
        name: "get_log",
        is_callable: true,
        handler: refuse,
    },
    Method {
        name: "start_backdoor",
        is_callable: true,
        handler: echo,
    },
    Method {
        name: "stop_backdoor",
        is_callable: true,
        handler: echo,
    },
    Method {
        name: "reset_connection",
        is_callable: false,
        handler: echo,
    },
];

/// A service that never exposed a backdoor method at all.
const PLAIN: [Method; 1] = [Method {
    name: "get_status",
    is_callable: true,
    handler: echo,
}];

/// Answers with the arguments it was called with, the way a keyword-argument
/// call does: a `__data` that is not an object cannot be splatted, so it is
/// refused by the handler rather than by the gate.
fn echo(data: &Value) -> Result<Value, String> {
    data.as_object()
        .map(|_| data.clone())
        .ok_or_else(|| "__data must be an object".to_owned())
}

/// Answers with a failure of its own wording, since a handler in another
/// language has no Python class name and traceback to format.
fn refuse(_data: &Value) -> Result<Value, String> {
    Err("no log for this shard".to_owned())
}

/// The gate settings a test dispatches under.
const fn gate(secret: Option<&'static str>, is_backdoor_enabled: bool) -> GateConfig<'static> {
    GateConfig {
        secret,
        is_backdoor_enabled,
    }
}

/// A well-formed message naming `method`, with one argument and the secret.
fn message(method: &str) -> Value {
    json!({
        "__id": REQUEST,
        "__method": method,
        "__data": {"limit": 3},
        "__secret": SECRET,
    })
}

/// A well-formed message with `key` carrying `value` instead, for a shape the
/// Python client never writes.
fn with(key: &str, value: Value) -> Value {
    let mut message = message("get_status");
    message
        .as_object_mut()
        .expect("a message must be an object")
        .insert(key.to_owned(), value);
    message
}

/// A well-formed message without `key`, which the Python client never omits.
fn without(key: &str) -> Value {
    let mut message = message("get_status");
    message.as_object_mut().expect("an object").remove(key);
    message
}

/// The decision for a message that was refused, carrying the refusal and no
/// result beside it: the null `__data` is what proves no handler ran.
fn refused(reason: &str) -> Decision {
    Decision::Answered(Response {
        id: REQUEST.to_owned(),
        data: Value::Null,
        error: Some(json!(reason)),
    })
}

#[test]
fn a_message_missing_a_required_key_is_dropped_rather_than_answered() {
    for key in ["__id", "__method", "__data"] {
        assert_eq!(
            dispatch(&without(key), &SERVICE, &gate(Some(SECRET), false)),
            Decision::Dropped(DropReason::MissingKey(key)),
            "a message without {key} has no reply to carry"
        );
    }
}

#[test]
fn a_message_that_is_not_an_object_is_dropped() {
    assert_eq!(
        dispatch(&json!([1, 2, 3]), &SERVICE, &gate(Some(SECRET), false)),
        Decision::Dropped(DropReason::NotAnObject)
    );
}

#[test]
fn an_id_that_is_not_a_string_is_dropped_rather_than_keyed_into_a_reply() {
    assert_eq!(
        dispatch(
            &with("__id", json!(7)),
            &SERVICE,
            &gate(Some(SECRET), false)
        ),
        Decision::Dropped(DropReason::IdNotAString)
    );
}

#[test]
fn a_secret_that_is_not_a_string_authenticates_as_no_secret_at_all() {
    assert_eq!(
        dispatch(
            &with("__secret", json!(7)),
            &SERVICE,
            &gate(Some(SECRET), false)
        ),
        refused("RPC authentication failed.")
    );
}

#[test]
fn a_service_that_configured_no_secret_authenticates_nobody() {
    assert_eq!(
        dispatch(&message("get_status"), &SERVICE, &gate(None, false)),
        refused("RPC authentication failed.")
    );
}

#[test]
fn authentication_is_refused_before_the_method_is_looked_up() {
    assert_eq!(
        dispatch(
            &message("no_such_method"),
            &SERVICE,
            &gate(Some("a different secret"), false)
        ),
        refused("RPC authentication failed.")
    );
}

#[test]
fn authentication_is_refused_before_the_backdoor_gate() {
    assert_eq!(
        dispatch(
            &message("start_backdoor"),
            &SERVICE,
            &gate(Some("a different secret"), false)
        ),
        refused("RPC authentication failed.")
    );
}

#[test]
fn a_disabled_backdoor_is_refused_though_the_secret_was_right() {
    for method in ["start_backdoor", "stop_backdoor"] {
        assert_eq!(
            dispatch(&message(method), &SERVICE, &gate(Some(SECRET), false)),
            refused("Backdoor RPC is disabled."),
            "{method} must be refused on a service that did not opt in"
        );
    }
}

#[test]
fn the_backdoor_gate_runs_before_the_method_is_looked_up() {
    assert_eq!(
        dispatch(
            &message("start_backdoor"),
            &PLAIN,
            &gate(Some(SECRET), false)
        ),
        refused("Backdoor RPC is disabled."),
        "a name that exists nowhere is still refused for the backdoor first"
    );
}

#[test]
fn an_enabled_backdoor_on_a_service_that_never_exposed_one_is_refused_as_missing() {
    assert_eq!(
        dispatch(
            &message("start_backdoor"),
            &PLAIN,
            &gate(Some(SECRET), true)
        ),
        refused("Method start_backdoor doesn't exist.")
    );
}

#[test]
fn a_name_no_entry_carries_is_refused_as_missing() {
    assert_eq!(
        dispatch(
            &message("no_such_method"),
            &SERVICE,
            &gate(Some(SECRET), false)
        ),
        refused("Method no_such_method doesn't exist.")
    );
}

#[test]
fn a_method_that_is_not_a_string_names_no_entry_at_all() {
    assert_eq!(
        dispatch(
            &with("__method", json!(7)),
            &SERVICE,
            &gate(Some(SECRET), false)
        ),
        refused("Method 7 doesn't exist.")
    );
}

#[test]
fn a_method_that_exists_without_being_callable_is_refused() {
    assert_eq!(
        dispatch(
            &message("reset_connection"),
            &SERVICE,
            &gate(Some(SECRET), false)
        ),
        refused("Method reset_connection isn't callable.")
    );
}

#[test]
fn a_callable_method_is_dispatched_with_the_arguments_it_named() {
    assert_eq!(
        dispatch(&message("get_status"), &SERVICE, &gate(Some(SECRET), false)),
        Decision::Answered(ok(REQUEST, json!({"limit": 3})))
    );
}

#[test]
fn an_enabled_backdoor_is_dispatched_on_a_service_that_exposes_one() {
    assert_eq!(
        dispatch(
            &message("start_backdoor"),
            &SERVICE,
            &gate(Some(SECRET), true)
        ),
        Decision::Answered(ok(REQUEST, json!({"limit": 3})))
    );
}

#[test]
fn the_arguments_reach_the_handler_exactly_as_they_arrived() {
    assert_eq!(
        dispatch(
            &with("__data", json!(7)),
            &SERVICE,
            &gate(Some(SECRET), false)
        ),
        refused("__data must be an object"),
        "a __data that cannot be splatted is refused by the handler, not by the gate"
    );
}

#[test]
fn a_failing_handler_answers_with_its_own_message_and_no_result() {
    assert_eq!(
        dispatch(&message("get_log"), &SERVICE, &gate(Some(SECRET), false)),
        refused("no log for this shard")
    );
}
