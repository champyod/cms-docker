//! The identity rows: their declarations, the credential they hold, and the
//! block ledger.
//!
//! The password checks are the ones a login makes: a built hash verifies, a
//! legacy `plaintext:` row never does, and a participation's own password
//! replaces the user's for that contest. The admin checks are the login pair and
//! the wildcard rule. Nothing opens a connection.

use cms_db::{
    hash_password, resolve, Admin, Bcrypt, BcryptVerifier, Codename, ColumnKind, Interval,
    Participation, PasswordForm, PermissionInputs, SecurityBlock, User, ADMIN, PARTICIPATION,
    SECURITY_BLOCK, USER, WILDCARD_PERMISSION,
};

/// A verifier that proves a path never reached bcrypt.
struct Unreachable;

impl BcryptVerifier for Unreachable {
    fn verify(&self, _candidate: &str, _hash: &str) -> bool {
        panic!("bcrypt must not be consulted for this candidate");
    }
}

fn user_with(password: PasswordForm) -> User {
    User {
        id: 1,
        first_name: "Ada".to_string(),
        last_name: "Lovelace".to_string(),
        username: Codename::parse("ada").expect("a codename"),
        password,
        email: None,
        timezone: None,
        preferred_languages: Vec::new(),
        last_login_at: None,
    }
}

fn participation_with(password: Option<PasswordForm>) -> Participation {
    Participation {
        id: 7,
        ip: None,
        starting_time: None,
        delay_time: Interval::zero(),
        extra_time: Interval::zero(),
        password,
        hidden: false,
        unrestricted: false,
        contest_id: 3,
        user_id: 1,
        team_id: None,
    }
}

#[test]
fn a_built_password_round_trips_through_the_stored_form() {
    let stored = hash_password("correct horse", "bcrypt").expect("bcrypt accepts this password");
    let form = PasswordForm::parse(&stored).expect("hash_password writes a bcrypt form");
    let user = user_with(form);

    assert!(user.verify_password("correct horse", &Bcrypt));
    assert!(!user.verify_password("wrong horse", &Bcrypt));
}

#[test]
fn a_plaintext_row_never_verifies_even_with_the_right_secret() {
    let user = user_with(PasswordForm::parse("plaintext:secret").expect("a representable row"));

    assert!(!user.verify_password("secret", &Bcrypt));
}

#[test]
fn an_over_long_candidate_is_refused_before_bcrypt_is_asked() {
    let user = user_with(PasswordForm::parse("bcrypt:$2b$12$synthetic").expect("a bcrypt row"));
    let over_long = "x".repeat(73);

    assert!(!user.verify_password(&over_long, &Unreachable));
}

#[test]
fn a_participation_password_replaces_the_users_credential() {
    let user = user_with(PasswordForm::parse("bcrypt:$2b$12$user-hash").expect("a bcrypt row"));
    let with_override = participation_with(Some(
        PasswordForm::parse("bcrypt:$2b$12$contest-hash").expect("a bcrypt row"),
    ));
    let without_override = participation_with(None);

    assert_eq!(
        with_override.credential(&user),
        &PasswordForm::parse("bcrypt:$2b$12$contest-hash").expect("the same row")
    );
    assert_eq!(without_override.credential(&user), &user.password);
}

#[test]
fn the_identity_declarations_validate_and_skip_their_keys() {
    assert_eq!(USER.validate(), Ok(()));
    assert_eq!(PARTICIPATION.validate(), Ok(()));
    assert_eq!(ADMIN.validate(), Ok(()));

    let carried: Vec<&str> = USER.value_columns().map(|column| column.name).collect();
    assert_eq!(
        carried,
        [
            "first_name",
            "last_name",
            "username",
            "password",
            "email",
            "timezone",
            "preferred_languages",
            "last_login_at",
        ]
    );
    let password = USER
        .columns
        .iter()
        .find(|column| column.name == "password")
        .expect("the password column is declared");
    assert!(password.has_default && !password.is_required());
}

fn admin_with(authentication: PasswordForm, enabled: bool) -> Admin {
    Admin {
        id: 4,
        name: "Grace Hopper".to_string(),
        username: Codename::parse("grace").expect("a codename"),
        authentication,
        enabled,
    }
}

fn keys(values: &[&str]) -> std::collections::BTreeSet<String> {
    values.iter().map(|value| (*value).to_string()).collect()
}

#[test]
fn an_admin_holding_only_the_wildcard_grants_a_key_it_never_registered() {
    let effective = resolve(&PermissionInputs {
        is_enabled: true,
        group_grants: keys(&[WILDCARD_PERMISSION]),
        ..PermissionInputs::default()
    });
    let admin = admin_with(
        PasswordForm::parse("bcrypt:$2b$12$synthetic").expect("a bcrypt row"),
        true,
    );

    assert!(admin.has_permission(&effective, &["never:registered"]));
    assert_eq!(effective.keys(), &keys(&[WILDCARD_PERMISSION]));
}

#[test]
fn an_expanded_wildcard_does_not_regrant_a_key_an_override_denied() {
    let effective = resolve(&PermissionInputs {
        is_enabled: true,
        group_grants: keys(&[WILDCARD_PERMISSION]),
        deny_overrides: keys(&["contest:read"]),
        registered_keys: keys(&["contest:read", "contest:delete"]),
        ..PermissionInputs::default()
    });
    let admin = admin_with(
        PasswordForm::parse("bcrypt:$2b$12$synthetic").expect("a bcrypt row"),
        true,
    );

    assert!(effective.keys().contains(WILDCARD_PERMISSION));
    assert!(!admin.has_permission(&effective, &["contest:read"]));
    assert!(admin.has_permission(&effective, &["contest:delete"]));
    assert!(admin.has_permission(&effective, &["contest:read", "contest:delete"]));
}

#[test]
fn an_admin_logs_in_only_with_its_password_and_only_while_enabled() {
    let stored = hash_password("let me in", "bcrypt").expect("bcrypt accepts this password");
    let form = PasswordForm::parse(&stored).expect("a bcrypt row");

    assert!(admin_with(form.clone(), true).authenticates("let me in", &Bcrypt));
    assert!(!admin_with(form.clone(), false).authenticates("let me in", &Bcrypt));
    assert!(!admin_with(form, true).authenticates("let me out", &Bcrypt));
}

#[test]
fn a_plaintext_admin_row_never_authenticates() {
    let admin = admin_with(
        PasswordForm::parse("plaintext:let me in").expect("a plaintext row"),
        true,
    );

    assert!(!admin.authenticates("let me in", &Bcrypt));
}

#[test]
fn the_security_block_table_validates_and_keys_on_kind_address_and_subject() {
    assert_eq!(SECURITY_BLOCK.validate(), Ok(()));

    let id = SECURITY_BLOCK
        .columns
        .first()
        .expect("a table declares its key");
    assert_eq!(id.kind, ColumnKind::BigInteger);
    assert!(id.primary_key && id.has_default);
    assert!(SECURITY_BLOCK.relationships.is_empty());

    let at = chrono::DateTime::from_timestamp(0, 0)
        .expect("the epoch is in range")
        .naive_utc();
    let block = SecurityBlock {
        id: 1,
        kind: "login".to_string(),
        source: "cms-web".to_string(),
        ip: Some("203.0.113.9".to_string()),
        subject: Some("ada".to_string()),
        detail: Some("{}".to_string()),
        started_at: at,
        expires_at: None,
        ended_at: None,
        ended_by: Some(4),
        active: true,
        created_at: at,
    };

    assert_eq!(
        block.identity(),
        ("login", Some("203.0.113.9"), Some("ada"))
    );
}
