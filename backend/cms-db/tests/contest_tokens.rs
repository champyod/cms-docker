//! Every token configuration the `contests` check constraints refuse, plus the
//! three modes and what each grants.
//!
//! The reference refuses these in the database, not in Python: the checks at
//! `src/cms/db/contest.py:52-57,164-198` are the whole rule. Each refusal here
//! names the column it reproduces, so a configuration the table would reject is
//! rejected before it reaches an `INSERT`.

use cms_db::{Interval, TokenConfigError, TokenGrant, TokenMode, TokenModeError, TokenPolicy};

/// A whole number of seconds, which every interval fixture is.
fn seconds(value: i64) -> Interval {
    Interval::from_seconds(value).expect("fixture seconds fit the interval column")
}

/// The default policy, which is infinite with the column's generation defaults.
fn policy() -> TokenPolicy {
    TokenPolicy::default()
}

#[test]
fn every_stored_mode_parses_and_spells_back() {
    for mode in [TokenMode::Disabled, TokenMode::Finite, TokenMode::Infinite] {
        assert_eq!(
            mode.as_str().parse::<TokenMode>(),
            Ok(mode),
            "{} did not round-trip",
            mode.as_str()
        );
    }
}

#[test]
fn the_mixed_aggregate_is_not_a_stored_mode() {
    assert_eq!(
        "mixed".parse::<TokenMode>(),
        Err(TokenModeError::Unknown("mixed".to_string()))
    );
}

#[test]
fn an_unknown_spelling_is_refused() {
    assert_eq!(
        "INFINITE".parse::<TokenMode>(),
        Err(TokenModeError::Unknown("INFINITE".to_string()))
    );
}

#[test]
fn each_mode_grants_differently() {
    assert_eq!(TokenMode::Disabled.grant(), TokenGrant::Never);
    assert_eq!(TokenMode::Finite.grant(), TokenGrant::Accrued);
    assert_eq!(TokenMode::Infinite.grant(), TokenGrant::Always);
}

#[test]
fn the_column_defaults_are_a_valid_policy() {
    let policy = policy();

    assert_eq!(policy.validate(), Ok(()));
    assert_eq!(policy.mode, TokenMode::Infinite);
    assert_eq!(policy.max_number, None);
    assert_eq!(policy.min_interval, Interval::zero());
    assert_eq!(policy.gen_initial, 2);
    assert_eq!(policy.gen_number, 2);
    assert_eq!(policy.gen_interval, seconds(30 * 60));
    assert_eq!(policy.gen_max, None);
}

#[test]
fn a_finite_policy_inside_every_check_is_accepted() {
    let policy = TokenPolicy {
        mode: TokenMode::Finite,
        max_number: Some(10),
        min_interval: seconds(60),
        gen_initial: 2,
        gen_number: 1,
        gen_interval: seconds(600),
        gen_max: Some(4),
    };

    assert_eq!(policy.validate(), Ok(()));
    assert_eq!(policy.grant(), TokenGrant::Accrued);
}

#[test]
fn a_zero_total_cap_is_refused() {
    let policy = TokenPolicy {
        max_number: Some(0),
        ..policy()
    };

    assert_eq!(
        policy.validate(),
        Err(TokenConfigError::MaxNumberNotPositive { found: 0 })
    );
}

#[test]
fn a_negative_total_cap_is_refused() {
    let policy = TokenPolicy {
        max_number: Some(-1),
        ..policy()
    };

    assert_eq!(
        policy.validate(),
        Err(TokenConfigError::MaxNumberNotPositive { found: -1 })
    );
}

#[test]
fn a_negative_minimum_interval_is_refused() {
    let policy = TokenPolicy {
        min_interval: seconds(-1),
        ..policy()
    };

    assert_eq!(
        policy.validate(),
        Err(TokenConfigError::MinIntervalNegative)
    );
}

#[test]
fn a_negative_initial_count_is_refused() {
    let policy = TokenPolicy {
        gen_initial: -1,
        ..policy()
    };

    assert_eq!(
        policy.validate(),
        Err(TokenConfigError::GenInitialNegative { found: -1 })
    );
}

#[test]
fn a_negative_generation_count_is_refused() {
    let policy = TokenPolicy {
        gen_number: -1,
        ..policy()
    };

    assert_eq!(
        policy.validate(),
        Err(TokenConfigError::GenNumberNegative { found: -1 })
    );
}

#[test]
fn a_zero_generation_interval_is_refused() {
    let policy = TokenPolicy {
        gen_interval: Interval::zero(),
        ..policy()
    };

    assert_eq!(
        policy.validate(),
        Err(TokenConfigError::GenIntervalNotPositive)
    );
}

#[test]
fn a_negative_generation_interval_is_refused() {
    let policy = TokenPolicy {
        gen_interval: seconds(-1),
        ..policy()
    };

    assert_eq!(
        policy.validate(),
        Err(TokenConfigError::GenIntervalNotPositive)
    );
}

#[test]
fn one_microsecond_of_generation_interval_is_accepted() {
    let policy = TokenPolicy {
        gen_interval: Interval::from_micros(1),
        ..policy()
    };

    assert_eq!(policy.validate(), Ok(()));
}

#[test]
fn a_non_positive_generation_cap_is_refused() {
    let policy = TokenPolicy {
        gen_max: Some(0),
        ..policy()
    };

    assert_eq!(
        policy.validate(),
        Err(TokenConfigError::GenMaxNotPositive { found: 0 })
    );
}

#[test]
fn an_initial_count_above_the_generation_cap_is_refused() {
    let policy = TokenPolicy {
        gen_initial: 5,
        gen_max: Some(4),
        ..policy()
    };

    assert_eq!(
        policy.validate(),
        Err(TokenConfigError::GenInitialAboveMax { initial: 5, max: 4 })
    );
}

#[test]
fn an_initial_count_equal_to_the_cap_is_accepted() {
    let policy = TokenPolicy {
        gen_initial: 4,
        gen_max: Some(4),
        ..policy()
    };

    assert_eq!(policy.validate(), Ok(()));
}

#[test]
fn an_absent_generation_cap_does_not_bound_the_initial_count() {
    let policy = TokenPolicy {
        gen_initial: 99,
        gen_max: None,
        ..policy()
    };

    assert_eq!(policy.validate(), Ok(()));
}

#[test]
fn the_checks_apply_whatever_the_mode_is() {
    let policy = TokenPolicy {
        mode: TokenMode::Disabled,
        gen_initial: 5,
        gen_max: Some(4),
        ..policy()
    };

    assert_eq!(
        policy.validate(),
        Err(TokenConfigError::GenInitialAboveMax { initial: 5, max: 4 })
    );
}
