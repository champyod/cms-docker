//! The identity rows: their declarations, and the credential they hold.
//!
//! The password checks are the ones a login makes: a built hash verifies, a
//! legacy `plaintext:` row never does, and a participation's own password
//! replaces the user's for that contest. Nothing opens a connection.

use cms_db::{
    hash_password, Bcrypt, BcryptVerifier, Codename, Interval, Participation, PasswordForm, User,
    PARTICIPATION, USER,
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
