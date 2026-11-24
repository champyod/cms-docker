//! Every checker input the process cannot invent, it refuses by name.

use crate::{
    run_with, supplied, PORT_VARIABLE, SECRET_VARIABLE, SERVICES_VARIABLE, SHARD_VARIABLE,
};

#[test]
fn a_missing_services_table_stops_the_process_and_is_named() {
    let output = run_with(&supplied(SERVICES_VARIABLE, None));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        !output.status.success(),
        "CMS_SERVICES unset must not start it"
    );
    assert!(
        stderr.contains(SERVICES_VARIABLE),
        "the refusal must name {SERVICES_VARIABLE}, got: {stderr}"
    );
}

#[test]
fn a_blank_services_table_is_refused_like_a_missing_one() {
    let output = run_with(&supplied(SERVICES_VARIABLE, Some("  \n\n ")));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(!output.status.success(), "a blank table must not start it");
    assert!(
        stderr.contains(SERVICES_VARIABLE),
        "the refusal must name {SERVICES_VARIABLE}, got: {stderr}"
    );
}

#[test]
fn a_malformed_services_table_is_refused_and_names_its_variable() {
    let output = run_with(&supplied(
        SERVICES_VARIABLE,
        Some("Peer|zero|127.0.0.1|22000\n"),
    ));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        !output.status.success(),
        "a malformed table must not start it"
    );
    assert!(
        stderr.contains(SERVICES_VARIABLE),
        "the refusal must name {SERVICES_VARIABLE}, got: {stderr}"
    );
    assert!(
        stderr.contains("Peer|zero"),
        "the bad row must be named: {stderr}"
    );
}

#[test]
fn an_unreadable_port_is_refused_rather_than_defaulted() {
    let output = run_with(&supplied(PORT_VARIABLE, Some("not-a-port")));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        !output.status.success(),
        "an unknown port must not start it"
    );
    assert!(
        stderr.contains(PORT_VARIABLE),
        "the refusal must name {PORT_VARIABLE}, got: {stderr}"
    );
}

#[test]
fn an_unreadable_shard_is_refused_rather_than_defaulted() {
    let output = run_with(&supplied(SHARD_VARIABLE, Some("not-a-shard")));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        !output.status.success(),
        "an unknown shard must not start it"
    );
    assert!(
        stderr.contains(SHARD_VARIABLE),
        "the refusal must name {SHARD_VARIABLE}, got: {stderr}"
    );
}

#[test]
fn the_rpc_secret_is_optional_at_startup() {
    let mut running = crate::spawn_with(&supplied(SECRET_VARIABLE, None));
    let address = running.started();
    assert!(
        address.ip().is_unspecified(),
        "the host binds every interface"
    );
    assert_ne!(address.port(), 0, "the kernel-selected port is reported");
}
