//! The identity the policies read, and the shapes they refuse.
//!
//! These run without a database: the value is what row-level security keys on, so
//! every refusal is decided here, before a connection is opened.

use std::ffi::OsString;

use cms_db::{
    default_actor, label_for, validate_actor, ActorError, ACTOR_ENV, ACTOR_SETTING,
    CONNECTION_STAMP_SQL, CORE_ACTOR, KNOWN_SYSTEM_ACTORS, TRANSACTION_STAMP_SQL,
};

/// The environment variable is process-wide, so the one test that writes it owns it.
struct EnvGuard(Option<OsString>);

impl EnvGuard {
    fn set(value: Option<&str>) -> Self {
        let previous = std::env::var_os(ACTOR_ENV);
        match value {
            Some(value) => std::env::set_var(ACTOR_ENV, value),
            None => std::env::remove_var(ACTOR_ENV),
        }
        Self(previous)
    }
}

impl Drop for EnvGuard {
    fn drop(&mut self) {
        match self.0.take() {
            Some(previous) => std::env::set_var(ACTOR_ENV, previous),
            None => std::env::remove_var(ACTOR_ENV),
        }
    }
}

#[test]
fn every_admin_id_of_up_to_nine_digits_is_accepted_verbatim() {
    for actor in ["admin:0", "admin:12", "admin:999999999"] {
        assert_eq!(validate_actor(actor), Ok(actor));
    }
}

#[test]
fn every_known_system_actor_is_accepted_verbatim() {
    assert_eq!(KNOWN_SYSTEM_ACTORS.len(), 5);
    for actor in KNOWN_SYSTEM_ACTORS {
        assert_eq!(validate_actor(actor), Ok(actor));
    }
}

#[test]
fn the_system_namespace_accepts_its_whole_character_class() {
    // The shape is accepted and the identity refused for being unknown: the two
    // refusals stay distinguishable, so a name sixty-four characters long is a
    // known shape naming nobody, not a malformed value.
    let longest = format!("system:{}", "a".repeat(64));
    let well_formed = [
        "system:a".to_owned(),
        "system:auth:extra".to_owned(),
        "system:core-1".to_owned(),
        "system:core_2".to_owned(),
        longest,
    ];
    for actor in well_formed {
        match validate_actor(&actor) {
            Err(ActorError::UnknownSystem { actor: refused, .. }) => assert_eq!(refused, actor),
            other => panic!("{actor} should be well formed but unknown, got {other:?}"),
        }
    }
}

#[test]
fn every_malformed_shape_is_refused() {
    let overlong = format!("system:{}", "a".repeat(65));
    let malformed = [
        "".to_owned(),
        " ".to_owned(),
        "admin".to_owned(),
        "admin:".to_owned(),
        "admin:abc".to_owned(),
        "admin:12:13".to_owned(),
        "admin:-1".to_owned(),
        "admin:+1".to_owned(),
        "admin: 1".to_owned(),
        "admin:1 ".to_owned(),
        "admin:1234567890".to_owned(),
        "admin:0x10".to_owned(),
        "Admin:1".to_owned(),
        " admin:5".to_owned(),
        "admin:5\n".to_owned(),
        "system".to_owned(),
        "system:".to_owned(),
        "system:1core".to_owned(),
        "system:_core".to_owned(),
        "system:-core".to_owned(),
        "system:Core".to_owned(),
        "system:core ".to_owned(),
        "system:core\n".to_owned(),
        "system:core/system".to_owned(),
        "cms.actor".to_owned(),
        overlong,
    ];
    for actor in malformed {
        match validate_actor(&actor) {
            Err(ActorError::Malformed(refused)) => assert_eq!(refused, actor),
            other => panic!("{actor:?} should be malformed, got {other:?}"),
        }
    }
}

#[test]
fn an_unknown_system_actor_names_the_allowlist() {
    let error = validate_actor("system:not-in-the-allowlist").unwrap_err();
    let ActorError::UnknownSystem { actor, known } = error else {
        panic!("expected an unknown-identity refusal");
    };
    assert_eq!(actor, "system:not-in-the-allowlist");
    for known_actor in KNOWN_SYSTEM_ACTORS {
        assert!(known.contains(known_actor), "{known} misses {known_actor}");
    }
}

#[test]
fn the_environment_variable_wins_and_is_validated() {
    let _guard = EnvGuard::set(Some("admin:5"));
    assert_eq!(default_actor(), Ok("admin:5".to_owned()));

    let _guard = EnvGuard::set(Some("  admin:7  "));
    assert_eq!(default_actor(), Ok("admin:7".to_owned()));

    let _guard = EnvGuard::set(Some("system:bogus"));
    assert!(matches!(
        default_actor(),
        Err(ActorError::UnknownSystem { .. })
    ));

    let _guard = EnvGuard::set(Some("not an actor"));
    assert!(matches!(default_actor(), Err(ActorError::Malformed(_))));
}

#[test]
fn an_unset_or_blank_variable_falls_back_to_the_core() {
    let _guard = EnvGuard::set(None);
    assert_eq!(default_actor(), Ok(CORE_ACTOR.to_owned()));

    let _guard = EnvGuard::set(Some("   "));
    assert_eq!(default_actor(), Ok(CORE_ACTOR.to_owned()));
}

#[test]
fn the_transaction_stamp_is_local_and_binds_its_value() {
    // A `false` here would be a cross-request authorization bug on every pooled
    // connection, one keyword away.
    assert!(
        TRANSACTION_STAMP_SQL.contains(ACTOR_SETTING),
        "{TRANSACTION_STAMP_SQL}"
    );
    assert!(
        TRANSACTION_STAMP_SQL.contains(", true)"),
        "{TRANSACTION_STAMP_SQL}"
    );
    assert_eq!(TRANSACTION_STAMP_SQL.matches("$1").count(), 1);
    assert!(
        !TRANSACTION_STAMP_SQL.contains("system:"),
        "the value must be bound"
    );
}

#[test]
fn the_dedicated_connection_stamp_is_the_only_session_scope() {
    assert!(
        CONNECTION_STAMP_SQL.contains(", false)"),
        "{CONNECTION_STAMP_SQL}"
    );
    assert_eq!(CONNECTION_STAMP_SQL.matches("$1").count(), 1);
}

#[test]
fn the_process_label_is_the_program_name_and_never_empty() {
    assert_eq!(label_for("/usr/bin/cmsWorker"), "cmsWorker");
    assert_eq!(label_for("cmsContestWebServer"), "cmsContestWebServer");
    assert_eq!(label_for(""), "cms");
    // A real argv[0] never ends in a separator; Rust's path rule still names the
    // directory there, where the reference's basename returned nothing.
    assert_eq!(label_for("/usr/bin/"), "bin");
}
