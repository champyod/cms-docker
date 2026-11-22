//! The engine's settings, read without a database.

use std::ffi::OsString;

use cms_db::{
    process_label, ActorError, Session, SessionConfig, SessionError, UnhonouredOption, ACTOR_ENV,
};

const URL: &str = "postgresql+psycopg2://cmsuser:secret@127.0.0.1:55433/cmsdb_test";
const UNREACHABLE: &str = "postgres://nobody@127.0.0.1:1/none";

/// The environment variable is process-wide, so a test that writes it owns it.
struct ActorVariable(Option<OsString>);

impl ActorVariable {
    fn set(value: &str) -> Self {
        let previous = std::env::var_os(ACTOR_ENV);
        std::env::set_var(ACTOR_ENV, value);
        Self(previous)
    }
}

impl Drop for ActorVariable {
    fn drop(&mut self) {
        match self.0.take() {
            Some(previous) => std::env::set_var(ACTOR_ENV, previous),
            None => std::env::remove_var(ACTOR_ENV),
        }
    }
}

#[test]
fn the_reference_defaults_carry_no_unhonoured_flag() {
    assert!(SessionConfig::new(URL).check().is_ok());
}

#[test]
fn twophase_commit_is_refused_by_name() {
    let config = SessionConfig {
        twophase_commit: true,
        ..SessionConfig::new(URL)
    };
    match config.check() {
        Err(SessionError::Unhonoured(option)) => {
            assert_eq!(option, UnhonouredOption::TwoPhaseCommit);
            assert_eq!(option.flag(), "database.twophase_commit");
            assert!(!option.reason().is_empty());
        }
        other => panic!("expected a refusal, got {other:?}"),
    }
}

#[test]
fn statement_echo_is_refused_by_name() {
    let config = SessionConfig {
        debug: true,
        ..SessionConfig::new(URL)
    };
    match config.check() {
        Err(SessionError::Unhonoured(option)) => {
            assert_eq!(option, UnhonouredOption::StatementEcho);
            assert_eq!(option.flag(), "database.debug");
        }
        other => panic!("expected a refusal, got {other:?}"),
    }
}

#[test]
fn the_sqlalchemy_driver_component_is_dropped_and_the_rest_is_kept() {
    let options = SessionConfig::new(URL).connect_options().expect("URL");
    assert_eq!(options.get_host(), "127.0.0.1");
    assert_eq!(options.get_port(), 55433);
    assert_eq!(options.get_database(), Some("cmsdb_test"));
    assert_eq!(options.get_username(), "cmsuser");
}

#[test]
fn a_plain_libpq_url_is_accepted_unchanged() {
    let options = SessionConfig::new("postgres://cmsuser@localhost/cmsdb")
        .connect_options()
        .expect("URL");
    assert_eq!(options.get_database(), Some("cmsdb"));
}

#[test]
fn a_non_postgresql_scheme_is_refused() {
    match SessionConfig::new("mysql://user@host/db").connect_options() {
        Err(SessionError::Url(url, reason)) => {
            assert_eq!(url, "mysql://user@host/db");
            assert!(reason.contains("mysql"), "{reason}");
        }
        other => panic!("expected a refusal, got {other:?}"),
    }
}

#[test]
fn a_value_without_a_scheme_is_refused() {
    assert!(matches!(
        SessionConfig::new("127.0.0.1/cmsdb").connect_options(),
        Err(SessionError::Url(_, _))
    ));
}

#[test]
fn the_connection_announces_the_program_label() {
    let options = SessionConfig::new(URL).connect_options().expect("URL");
    assert_eq!(
        options.get_application_name(),
        Some(process_label().as_str())
    );
}

#[test]
fn an_invalid_identity_refuses_the_session_before_any_connection() {
    // The URL points at a port nothing listens on: an Actor refusal rather than a
    // connection error is the proof that no fallback identity is tried first.
    let _variable = ActorVariable::set("system:bogus");
    let opened = sqlx::test_block_on(Session::open(&SessionConfig::new(UNREACHABLE)));
    let error = match opened {
        Ok(_) => panic!("an unknown identity must refuse the session"),
        Err(error) => error,
    };
    assert!(
        matches!(error, SessionError::Actor(ActorError::UnknownSystem { .. })),
        "expected the identity refusal, got {error:?}"
    );
}
