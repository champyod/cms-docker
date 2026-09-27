//! The exact refusal each gate produces, and what a dispatched call answers.
//!
//! A decision is the gate's only output, so a refusal that comes back with a
//! null `__data` is itself the proof that no handler ran: the handlers in
//! `dispatch_fixtures` answer with a value of their own, so a dispatched one
//! would have put it there. That keeps the tests pure — no counters, no locks,
//! nothing shared between them — and every assertion is a whole response, so
//! the correlation id, the absent result and the exact error are checked
//! together.
//!
//! Every error string below is the one `process_incoming_request` writes,
//! character for character. A refusal edited on this side without the Python
//! side being edited fails here rather than in a caller. The order those
//! refusals are reached in is proved in `dispatch_order`.

mod dispatch_fixtures;

use cms_proto::{dispatch, ok, Decision, DropReason};
use dispatch_fixtures::{gate, message, refused, REQUEST, SECRET, SERVICE};
use serde_json::{json, Value};

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
