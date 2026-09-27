//! Contract tests for the four column mappings.
//!
//! Every shape here is a value one of these columns actually holds: the
//! `interval` text and binary layouts Postgres writes, a `DIGEST` value from
//! `fsobjects`, an `admins.authentication` string, and the key sets the
//! permission tables resolve from. Nothing opens a connection. The binary
//! layouts are checked against the driver's own encoder rather than a copy of
//! it, so agreement with the driver is what is being asserted.

use std::collections::BTreeSet;

use chrono::Duration;
use cms_db::{
    resolve, AuthError, BcryptPassword, BcryptVerifier, CacheError, CacheHandle, DigestError,
    Effect, EffectivePermissions, FileDigest, Interval, IntervalError, PasswordForm,
    PermissionInputs, PlaintextPassword, RemoveAction, DIGEST_HEX_LEN, MICROS_PER_DAY,
    MICROS_PER_HOUR, MICROS_PER_MINUTE, MICROS_PER_SECOND, TOMBSTONE, WILDCARD_PERMISSION,
};
use sqlx::encode::Encode;
use sqlx::postgres::types::PgInterval;
use sqlx::postgres::PgArgumentBuffer;

/// A digest that is not a digest of anything, used only to exercise the shape.
const SYNTHETIC_DIGEST: &str = "0123456789abcdef0123456789abcdef01234567";

fn keys(values: &[&str]) -> BTreeSet<String> {
    values.iter().map(|value| (*value).to_string()).collect()
}

fn digest(text: &str) -> FileDigest {
    text.parse()
        .expect("digest fixture must satisfy the DIGEST domain")
}

// ---------------------------------------------------------------- interval --

#[test]
fn the_binary_layout_is_the_one_the_driver_writes() {
    // 3_600_000_000 microseconds, then one day, then no month, all big-endian.
    let captured = [
        0x00, 0x00, 0x00, 0x00, 0xd6, 0x93, 0xa4, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00,
        0x00,
    ];
    let interval = Interval::from_micros(MICROS_PER_DAY + MICROS_PER_HOUR);

    assert_eq!(encoded(&interval), captured);
    assert_eq!(encoded(&interval.to_pg().expect("one day fits")), captured);
}

#[test]
fn a_driver_interval_reduces_to_its_microseconds() {
    let from_driver = Interval::from_pg(PgInterval {
        months: 0,
        days: 1,
        microseconds: 2 * MICROS_PER_HOUR,
    })
    .expect("a day and hours have a fixed length");

    assert_eq!(
        from_driver,
        Interval::from_micros(MICROS_PER_DAY + 2 * MICROS_PER_HOUR)
    );
    assert_eq!(from_driver.whole_seconds(), 93_600);
}

#[test]
fn a_month_is_refused_because_it_has_no_fixed_length() {
    let with_month = PgInterval {
        months: 1,
        days: 0,
        microseconds: 0,
    };

    assert_eq!(
        Interval::from_pg(with_month),
        Err(IntervalError::CalendarField { unit: "mon" })
    );
}

#[test]
fn the_text_layout_reads_back_every_form_the_column_is_written_in() {
    let cases = [
        ("00:00:00", 0),
        ("02:00:00", 2 * MICROS_PER_HOUR),
        ("25 min", 25 * MICROS_PER_MINUTE),
        (
            "3 days 04:05:06",
            3 * MICROS_PER_DAY
                + 4 * MICROS_PER_HOUR
                + 5 * MICROS_PER_MINUTE
                + 6 * MICROS_PER_SECOND,
        ),
        ("2 days", 2 * MICROS_PER_DAY),
        ("@ 1 day 02:00:00", MICROS_PER_DAY + 2 * MICROS_PER_HOUR),
        ("1 12:00:00", MICROS_PER_DAY + 12 * MICROS_PER_HOUR),
        ("00:00:00.500000", 500_000),
        ("-00:00:01", -MICROS_PER_SECOND),
        ("-3 days", -3 * MICROS_PER_DAY),
    ];

    for (text, micros) in cases {
        assert_eq!(
            text.parse::<Interval>().map(Interval::as_micros),
            Ok(micros),
            "{text}"
        );
    }
}

#[test]
fn a_mixed_sign_interval_reads_each_component_on_its_own() {
    // A positive component after a negative one is written with an explicit `+`.
    assert_eq!(
        "-1 days +04:05:06".parse::<Interval>(),
        Ok(Interval::from_micros(
            -MICROS_PER_DAY + 4 * MICROS_PER_HOUR + 5 * MICROS_PER_MINUTE + 6 * MICROS_PER_SECOND
        ))
    );
}

#[test]
fn unreadable_interval_text_is_refused_rather_than_guessed() {
    for text in [
        "",
        "   ",
        "@",
        "5",
        "1 fortnight",
        "1:2:3:4",
        "25:00:00",
        "00:60:00",
        "00:00:60",
        "01.5 days",
    ] {
        assert!(
            text.parse::<Interval>().is_err(),
            "{text} should be refused"
        );
    }
}

#[test]
fn a_year_or_month_in_text_is_named_as_the_reason() {
    assert_eq!(
        "1 mon".parse::<Interval>(),
        Err(IntervalError::CalendarField { unit: "mon" })
    );
    assert_eq!(
        "2 years".parse::<Interval>(),
        Err(IntervalError::CalendarField { unit: "year" })
    );
}

#[test]
fn a_timedelta_crosses_over_unchanged() {
    let original = Duration::seconds(5_400);

    let round_tripped = Interval::from_duration(original)
        .expect("whole seconds cross over")
        .to_duration();

    assert_eq!(round_tripped, original);
}

#[test]
fn a_timedelta_finer_than_a_microsecond_is_refused() {
    let too_fine = Duration::nanoseconds(1_001);

    assert_eq!(
        Interval::from_duration(too_fine),
        Err(IntervalError::SubMicrosecond)
    );
}

#[test]
fn the_two_check_constraints_are_the_predicates_the_columns_use() {
    let zero = Interval::zero();
    let positive = Interval::from_micros(1);

    assert!(zero.is_non_negative() && !zero.is_positive());
    assert!(positive.is_non_negative() && positive.is_positive());
    assert!(!Interval::from_micros(-1).is_non_negative());
}

#[test]
fn ordering_is_total_so_two_durations_never_compare_equal_by_rounding() {
    let mut durations = [
        Interval::from_micros(MICROS_PER_DAY),
        Interval::from_micros(-1),
        Interval::zero(),
        Interval::from_micros(1),
        Interval::from_micros(MICROS_PER_DAY + 1),
    ];
    durations.sort();

    let expected = [-1, 0, 1, MICROS_PER_DAY, MICROS_PER_DAY + 1];
    let sorted: Vec<i64> = durations.iter().map(|i| i.as_micros()).collect();

    assert_eq!(sorted, expected);
}

#[test]
fn seconds_beyond_the_microsecond_range_are_refused() {
    assert_eq!(
        Interval::from_seconds(i64::MAX),
        Err(IntervalError::OutOfRange)
    );
}

// ------------------------------------------------------------------ digest --

#[test]
fn the_digest_domain_accepts_a_sha1_and_the_tombstone() {
    assert_eq!(digest(SYNTHETIC_DIGEST).as_str(), SYNTHETIC_DIGEST);
    assert_eq!(SYNTHETIC_DIGEST.len(), DIGEST_HEX_LEN);
    assert!(!digest(SYNTHETIC_DIGEST).is_tombstone());
    assert!(digest(TOMBSTONE).is_tombstone());
}

#[test]
fn the_digest_domain_refuses_everything_else_it_names() {
    assert_eq!("".parse::<FileDigest>(), Err(DigestError::Empty));
    assert_eq!(
        "abc".parse::<FileDigest>(),
        Err(DigestError::Length { found: 3 })
    );
    assert_eq!(
        "0123456789ABCDEF0123456789abcdef01234567".parse::<FileDigest>(),
        Err(DigestError::NotLowercaseHex { found: 'A' })
    );
    assert_eq!(
        "0123456789abcdef0123456789abcdef0123456g".parse::<FileDigest>(),
        Err(DigestError::NotLowercaseHex { found: 'g' })
    );
    assert_eq!(
        "X".parse::<FileDigest>(),
        Err(DigestError::Length { found: 1 })
    );
}

#[test]
fn the_file_cache_refuses_the_tombstone_and_keeps_it_out_of_a_removal() {
    let stored = CacheHandle::new(digest(SYNTHETIC_DIGEST));
    let gone = CacheHandle::new(FileDigest::tombstone());

    assert_eq!(stored.open().map(FileDigest::as_str), Ok(SYNTHETIC_DIGEST));
    assert_eq!(gone.open().err(), Some(CacheError::Tombstone));
    assert_eq!(stored.remove(), RemoveAction::Forward);
    assert_eq!(gone.remove(), RemoveAction::Skipped);
    assert!(gone.is_tombstone() && !stored.is_tombstone());
}

// -------------------------------------------------------------------- auth --

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

// -------------------------------------------------------------- permission --

#[test]
fn group_grants_and_allow_overrides_are_unioned() {
    let inputs = PermissionInputs {
        is_enabled: true,
        group_grants: keys(&["contest:read"]),
        allow_overrides: keys(&["contest:update"]),
        ..PermissionInputs::default()
    };

    let effective = resolve(&inputs);

    assert!(effective.grants("contest:read"));
    assert!(effective.grants("contest:update"));
    assert!(!effective.grants("contest:delete"));
}

#[test]
fn a_deny_wins_over_both_the_groups_and_the_wildcard() {
    let with_wildcard = PermissionInputs {
        is_enabled: true,
        group_grants: keys(&[WILDCARD_PERMISSION, "contest:read"]),
        deny_overrides: keys(&["contest:read"]),
        registered_keys: keys(&["contest:read", "contest:delete"]),
        ..PermissionInputs::default()
    };

    let effective = resolve(&with_wildcard);

    assert!(!effective.grants("contest:read"));
    assert!(effective.grants("contest:delete"));
}

#[test]
fn denying_the_wildcard_itself_leaves_nothing_behind() {
    let inputs = PermissionInputs {
        is_enabled: true,
        group_grants: keys(&[WILDCARD_PERMISSION]),
        deny_overrides: keys(&[WILDCARD_PERMISSION]),
        registered_keys: keys(&["contest:read", "contest:delete"]),
        ..PermissionInputs::default()
    };

    let effective = resolve(&inputs);

    assert!(effective.is_empty());
    assert!(!effective.grants("contest:read"));
    assert_eq!(effective, EffectivePermissions::none());
}

#[test]
fn a_disabled_or_missing_admin_resolves_to_nothing() {
    let inputs = PermissionInputs {
        is_enabled: false,
        group_grants: keys(&[WILDCARD_PERMISSION]),
        registered_keys: keys(&["contest:read"]),
        ..PermissionInputs::default()
    };

    assert_eq!(resolve(&inputs), EffectivePermissions::none());
    assert!(resolve(&inputs).is_empty());
}

#[test]
fn an_unexpanded_wildcard_alone_still_grants_everything() {
    let inputs = PermissionInputs {
        is_enabled: true,
        group_grants: keys(&[WILDCARD_PERMISSION]),
        ..PermissionInputs::default()
    };

    let effective = resolve(&inputs);

    assert!(effective.grants("contest:read"));
    assert!(effective.grants("never:registered"));
    assert_eq!(effective.keys(), &keys(&[WILDCARD_PERMISSION]));
}

#[test]
fn an_expanded_wildcard_stops_granting_a_key_it_never_registered() {
    let inputs = PermissionInputs {
        is_enabled: true,
        group_grants: keys(&[WILDCARD_PERMISSION]),
        registered_keys: keys(&["contest:read"]),
        ..PermissionInputs::default()
    };

    let effective = resolve(&inputs);

    assert!(effective.grants("contest:read"));
    assert!(!effective.grants("never:registered"));
    assert!(effective.keys().contains(WILDCARD_PERMISSION));
}

#[test]
fn an_effect_column_the_python_side_matches_neither_grants_nor_denies() {
    assert_eq!(Effect::of("allow"), Some(Effect::Allow));
    assert_eq!(Effect::of("deny"), Some(Effect::Deny));
    assert_eq!(Effect::of(""), None);
    assert_eq!(Effect::of("DENY"), None);
    assert_eq!(Effect::of("permitted"), None);
}

fn encoded<T: Encode<'static, sqlx::Postgres>>(value: &T) -> Vec<u8> {
    let mut buffer = PgArgumentBuffer::default();
    let written = value
        .encode(&mut buffer)
        .expect("an in-range value encodes without error");
    assert!(!written.is_null(), "a value is never encoded as null");
    buffer.to_vec()
}
