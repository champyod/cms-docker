//! An `admins.authentication` value, split and checked as the Python side does.
//!
//! Every shape here is a string the column actually holds: a method, a colon and
//! a payload, where the payload may itself hold colons. The two methods
//! `validate_password` knows are the only ones that parse, and no form of a
//! credential is ever formatted, because a derived `Debug` would put the secret
//! in a log line. Nothing opens a connection.

use cms_db::{AuthError, BcryptPassword, BcryptVerifier, PasswordForm, PlaintextPassword};

#[test]
fn a_stored_credential_splits_on_its_first_colon() {
    let form = PasswordForm::parse("plaintext:pa:ss").expect("a colon in the payload is payload");

    let payload = form.plaintext().expect("the form is plaintext");
    assert!(payload.matches("pa:ss"));
    assert!(!payload.matches("pa:sa"));
    assert!(form.bcrypt().is_none());
}

#[test]
fn the_two_methods_are_told_apart_by_name() {
    let bcrypt = PasswordForm::parse("bcrypt:$2b$12$synthetic").expect("bcrypt is known");

    assert_eq!(
        bcrypt.bcrypt().map(BcryptPassword::hash),
        Some("$2b$12$synthetic")
    );
    assert!(bcrypt.plaintext().is_none());
}

#[test]
fn a_credential_the_python_side_would_refuse_is_refused_here() {
    assert_eq!(
        PasswordForm::parse("plaintextsecret"),
        Err(AuthError::NoMethodSeparator)
    );
    assert_eq!(
        PasswordForm::parse("scrypt:secret"),
        Err(AuthError::UnknownMethod {
            method: "scrypt".to_string()
        })
    );
}

#[test]
fn the_plaintext_path_compares_byte_for_byte() {
    let stored = PlaintextPassword::new("dummy-password");

    assert!(stored.matches("dummy-password"));
    assert!(!stored.matches("dummy-passwore"));
    assert!(!stored.matches(""));
    assert!(!PlaintextPassword::new("").matches("x"));
}

#[test]
fn the_bcrypt_path_hands_the_stored_hash_to_the_verifier() {
    struct Fixed;

    impl BcryptVerifier for Fixed {
        fn verify(&self, _candidate: &str, hash: &str) -> bool {
            hash == "known-hash"
        }
    }

    let stored = BcryptPassword::new("known-hash");

    assert!(stored.matches("anything", &Fixed));
    assert!(!BcryptPassword::new("other-hash").matches("anything", &Fixed));
}

#[test]
fn neither_credential_form_is_ever_formatted_in_the_clear() {
    let form = PasswordForm::parse("plaintext:dummy-password").expect("a valid form");

    assert_eq!(format!("{form:?}"), "Plaintext(<redacted>)");
    assert!(!format!("{form:?}").contains("dummy-password"));
    assert_eq!(
        format!(
            "{:?}",
            PasswordForm::Bcrypt(BcryptPassword::new("$2b$12$x"))
        ),
        "Bcrypt(<redacted>)"
    );
}
