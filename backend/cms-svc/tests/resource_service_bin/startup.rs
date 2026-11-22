//! The binary's input handling: every variable it cannot invent, it refuses, naming it.

use std::io::{BufRead, BufReader};

use crate::{
    run_with, spawn_with, supplied, ADDRESS_VARIABLE, AUTORESTART_VARIABLE, COORD_VARIABLE,
    SECRET_VARIABLE, SERVICES_VARIABLE,
};

#[test]
fn a_missing_variable_stops_the_process_and_is_named() {
    for absent in [
        ADDRESS_VARIABLE,
        SECRET_VARIABLE,
        COORD_VARIABLE,
        SERVICES_VARIABLE,
    ] {
        let output = run_with(&supplied(absent, None));
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(
            !output.status.success(),
            "{absent} unset must not start the service, stdout: {}",
            String::from_utf8_lossy(&output.stdout)
        );
        assert!(
            stderr.contains(absent),
            "the refusal must name {absent}, got: {stderr}"
        );
    }
}

#[test]
fn a_blank_table_is_refused_like_a_missing_one() {
    let output = run_with(&supplied(SERVICES_VARIABLE, Some("   \n\n  ")));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(!output.status.success(), "a blank table must not start it");
    assert!(
        stderr.contains(SERVICES_VARIABLE),
        "the refusal must name {SERVICES_VARIABLE}, got: {stderr}"
    );
}

#[test]
fn the_coordinate_must_name_a_row_of_the_table() {
    let output = run_with(&supplied(COORD_VARIABLE, Some("ResourceService,1")));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        !output.status.success(),
        "a coordinate with no row must not start it"
    );
    assert!(
        stderr.contains(COORD_VARIABLE),
        "the refusal must name {COORD_VARIABLE}, got: {stderr}"
    );
}

#[test]
fn an_unreadable_autorestart_value_is_refused_rather_than_read_as_false() {
    let output = run_with(&supplied(AUTORESTART_VARIABLE, Some("yes")));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        !output.status.success(),
        "an unknown flag must not start it"
    );
    assert!(
        stderr.contains(AUTORESTART_VARIABLE),
        "the refusal must name {AUTORESTART_VARIABLE}, got: {stderr}"
    );
}

#[test]
fn the_service_binds_and_reports_the_address_it_bound() {
    let mut running = spawn_with(&supplied(ADDRESS_VARIABLE, Some("127.0.0.1:0")));
    let stdout = running.0.stdout.take().expect("stdout is piped");
    let mut reported = String::new();
    BufReader::new(stdout)
        .read_line(&mut reported)
        .expect("the bound address is readable on stdout");
    assert!(
        reported.starts_with("cms-resource-service listening on 127.0.0.1:"),
        "the address it bound must be reported, got: {reported:?}"
    );
    assert!(
        !reported.trim_end().ends_with(":0"),
        "the port the kernel picked must be the one reported, got: {reported:?}"
    );
}
