//! The binary's input handling: every variable it cannot invent, it refuses, naming it.

use std::io::{BufRead, BufReader};

use crate::{
    run_with, spawn_with, supplied, Sandbox, ADDRESS_VARIABLE, LOG_DIR_VARIABLE, SECRET_VARIABLE,
};

#[test]
fn a_missing_variable_stops_the_process_and_is_named() {
    let sandbox = Sandbox::new("missing");
    for absent in [ADDRESS_VARIABLE, SECRET_VARIABLE, LOG_DIR_VARIABLE] {
        let output = run_with(&supplied(&sandbox, absent, None));
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
fn a_blank_variable_is_refused_like_a_missing_one() {
    let sandbox = Sandbox::new("blank");
    let output = run_with(&supplied(&sandbox, SECRET_VARIABLE, Some("   ")));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(!output.status.success(), "a blank secret must not start it");
    assert!(
        stderr.contains(SECRET_VARIABLE),
        "the refusal must name {SECRET_VARIABLE}, got: {stderr}"
    );
}

#[test]
fn the_service_binds_and_reports_the_address_it_bound() {
    let sandbox = Sandbox::new("bound");
    let mut running = spawn_with(&supplied(&sandbox, ADDRESS_VARIABLE, Some("127.0.0.1:0")));
    let stdout = running.0.stdout.take().expect("stdout is piped");
    let mut reported = String::new();
    BufReader::new(stdout)
        .read_line(&mut reported)
        .expect("the bound address is readable on stdout");
    assert!(
        reported.starts_with("cms-log-service listening on 127.0.0.1:"),
        "the address it bound must be reported, got: {reported:?}"
    );
    assert!(
        !reported.trim_end().ends_with(":0"),
        "the port the kernel picked must be the one reported, got: {reported:?}"
    );
}
