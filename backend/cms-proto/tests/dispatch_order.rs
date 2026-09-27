//! The order the gate applies its refusals in, one precedence at a time.
//!
//! The order is the security property `dispatch` exists to hold in one place: a
//! caller that cannot prove it knows the secret never learns which methods the
//! service has, and a caller refused for the backdoor has already proven that
//! it does. Each test below names the two gates that could both fire on one
//! message and pins which of the two refusals the caller is given.

mod dispatch_fixtures;

use cms_proto::{dispatch, Method};
use dispatch_fixtures::{echo, gate, message, refused, SECRET, SERVICE};

/// A service that never exposed a backdoor method at all.
const PLAIN: [Method; 1] = [Method {
    name: "get_status",
    is_callable: true,
    handler: echo,
}];

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
