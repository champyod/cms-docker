//! Startup refusals name the variable that cannot be used.

use crate::{run_with, DATABASE_URL_VARIABLE, PORT_VARIABLE, SHARD_VARIABLE, WORKERS_VARIABLE};

#[test]
fn a_missing_database_url_is_refused_by_name() {
    let crate::Finished {
        status,
        stdout,
        stderr,
    } = run_with(&[(PORT_VARIABLE, "0".to_owned())]);

    assert!(!status.success(), "startup must fail: {status:?}");
    let stderr = String::from_utf8(stderr).expect("stderr is UTF-8");
    assert!(stderr.contains(DATABASE_URL_VARIABLE), "{stderr}");
    assert!(stdout.is_empty(), "no listener may be reported");
}

#[test]
fn a_malformed_port_is_refused_by_value_before_connecting() {
    let crate::Finished {
        status,
        stdout,
        stderr,
    } = run_with(&[
        (
            DATABASE_URL_VARIABLE,
            "postgres://unused@127.0.0.1:1/unused".to_owned(),
        ),
        (PORT_VARIABLE, "not-a-port".to_owned()),
    ]);

    assert!(!status.success(), "startup must fail: {status:?}");
    let stderr = String::from_utf8(stderr).expect("stderr is UTF-8");
    assert!(stderr.contains(PORT_VARIABLE), "{stderr}");
    assert!(stderr.contains("\"not-a-port\""), "{stderr}");
    assert!(!stderr.contains("cannot open"), "{stderr}");
    assert!(stdout.is_empty(), "no listener may be reported");
}

#[test]
fn a_malformed_shard_is_refused_by_value() {
    let crate::Finished {
        status,
        stdout,
        stderr,
    } = run_with(&[
        (
            DATABASE_URL_VARIABLE,
            "postgres://unused@127.0.0.1:1/unused".to_owned(),
        ),
        (SHARD_VARIABLE, "not-a-shard".to_owned()),
    ]);

    assert!(!status.success(), "startup must fail: {status:?}");
    let stderr = String::from_utf8(stderr).expect("stderr is UTF-8");
    assert!(stderr.contains(SHARD_VARIABLE), "{stderr}");
    assert!(stdout.is_empty(), "no listener may be reported");
}

#[test]
fn a_malformed_worker_address_is_refused_by_value() {
    let crate::Finished {
        status,
        stdout,
        stderr,
    } = run_with(&[
        (
            DATABASE_URL_VARIABLE,
            "postgres://unused@127.0.0.1:1/unused".to_owned(),
        ),
        (WORKERS_VARIABLE, "not-an-address".to_owned()),
    ]);

    assert!(!status.success(), "startup must fail: {status:?}");
    let stderr = String::from_utf8(stderr).expect("stderr is UTF-8");
    assert!(stderr.contains(WORKERS_VARIABLE), "{stderr}");
    assert!(stdout.is_empty(), "no listener may be reported");
}
