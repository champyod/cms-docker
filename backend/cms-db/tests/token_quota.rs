//! The token quota the `Task` columns set, and the balance `tokening.py:52-176` rebuilds.

use chrono::{DateTime, Duration, NaiveDateTime};
use cms_db::{merge, Interval, Playable, TokenMode, TokenRules, Tokens};

/// The instant every fixture measures from.
const START_SECONDS: i64 = 1_700_000_000;

/// The contest's start, and the reference the fixtures measure against.
fn start() -> NaiveDateTime {
    DateTime::from_timestamp(START_SECONDS, 0)
        .expect("fixture seconds are in range")
        .naive_utc()
}

/// A timestamp `minutes` after the start.
fn after(minutes: i64) -> NaiveDateTime {
    start() + Duration::minutes(minutes)
}

/// A finite task that starts with `initial` tokens and generates none.
fn finite(initial: i32) -> TokenRules {
    TokenRules {
        mode: TokenMode::Finite,
        max_number: None,
        min_interval: Interval::zero(),
        gen_initial: initial,
        gen_number: 0,
        gen_interval: Interval::from_seconds(600).expect("ten minutes"),
        gen_max: None,
    }
}

/// The same task with a total allowance of `max` plays.
fn capped(initial: i32, max: i32) -> TokenRules {
    TokenRules {
        max_number: Some(max),
        ..finite(initial)
    }
}

#[test]
fn a_disabled_task_never_offers_a_token() {
    let quota = TokenRules::disabled().available(start(), &[], after(120));

    assert_eq!(quota.available, Tokens::Count(0));
    assert!(!quota.may_play());
}

#[test]
fn an_infinite_task_always_offers_a_token() {
    let rules = TokenRules {
        mode: TokenMode::Infinite,
        ..finite(0)
    };
    let quota = rules.available(start(), &[after(1), after(2)], after(3));

    assert_eq!(quota.available, Tokens::Infinite);
    assert!(quota.may_play());
}

#[test]
fn a_finite_quota_spends_one_token_per_play() {
    let rules = finite(2);

    let fresh = rules.available(start(), &[], after(1));
    let spent = rules.available(start(), &[after(1)], after(2));

    assert_eq!(fresh.available, Tokens::Count(2));
    assert_eq!(spent.available, Tokens::Count(1));
    assert!(fresh.may_play() && spent.may_play());
}

#[test]
fn a_finite_quota_with_no_tokens_left_refuses() {
    let quota = finite(1).available(start(), &[after(1)], after(2));

    assert_eq!(quota.available, Tokens::Count(0));
    assert!(
        !quota.may_play(),
        "a spent balance must refuse the next play"
    );
}

#[test]
fn the_total_allowance_caps_the_balance_at_what_is_left_to_play() {
    // Balance 2 from `gen_initial`, one play spent, allowance 2: one play left.
    let one_left = capped(2, 2).available(start(), &[after(1)], after(2));

    assert_eq!(one_left.available, Tokens::Count(1));
    // The allowance is spent, so no generation will ever add to it again.
    assert_eq!(one_left.next_generation, None);
}

#[test]
fn a_quota_overspent_against_its_allowance_refuses_rather_than_owing() {
    // Two plays were accepted while the contest allowed them; the task allows one.
    let overspent = capped(2, 1).available(start(), &[after(1), after(2)], after(3));

    assert_eq!(overspent.available, Tokens::Count(0));
    assert!(
        !overspent.may_play(),
        "the reference's `>= allowance` leaves a negative balance, which its `== 0` check reads as tokens left"
    );
}

#[test]
fn generation_adds_tokens_only_at_whole_periods() {
    let rules = TokenRules {
        gen_number: 1,
        ..finite(0)
    };

    let before = rules.available(start(), &[], after(9));
    let at_period = rules.available(start(), &[], after(10));
    let two_periods = rules.available(start(), &[], after(25));

    assert_eq!(before.available, Tokens::Count(0));
    assert_eq!(at_period.available, Tokens::Count(1));
    assert_eq!(two_periods.available, Tokens::Count(2));
    assert_eq!(at_period.next_generation, Some(after(20)));
}

#[test]
fn generation_stops_at_its_own_cap_and_leaves_no_next_time() {
    let rules = TokenRules {
        gen_number: 1,
        gen_max: Some(1),
        ..finite(0)
    };
    let quota = rules.available(start(), &[], after(25));

    assert_eq!(quota.available, Tokens::Count(1));
    assert_eq!(quota.next_generation, None);
}

#[test]
fn the_min_interval_blocks_a_play_until_it_expires() {
    let rules = TokenRules {
        min_interval: Interval::from_seconds(600).expect("ten minutes"),
        ..finite(5)
    };
    let played = after(1);

    let waiting = rules.available(start(), &[played], played + Duration::minutes(1));
    let expired = rules.available(start(), &[played], played + Duration::minutes(10));

    assert_eq!(waiting.playable_from, Some(played + Duration::minutes(10)));
    assert!(
        !waiting.may_play(),
        "a balance is not a play while the wait holds"
    );
    assert_eq!(expired.playable_from, None);
    assert!(expired.may_play());
}

#[test]
fn a_balance_of_zero_with_no_generation_left_reports_no_wait() {
    let rules = capped(1, 1);
    let quota = rules.available(start(), &[after(1)], after(2));

    assert_eq!(quota.playable_from, None);
    assert!(!quota.may_play());
}

#[test]
fn the_stricter_of_two_rule_sets_decides_the_balance() {
    let contest = Playable {
        available: Tokens::Count(0),
        next_generation: None,
        playable_from: None,
    };
    let task = TokenRules::disabled().available(start(), &[], after(1));

    assert_eq!(merge(contest, task).available, Tokens::Count(0));
    assert!(!merge(contest, task).may_play());
}

#[test]
fn an_unlimited_side_yields_to_the_limited_one() {
    let unlimited = TokenRules {
        mode: TokenMode::Infinite,
        ..finite(0)
    }
    .available(start(), &[], after(1));
    let limited = finite(3).available(start(), &[], after(1));

    let merged = merge(unlimited, limited);

    assert_eq!(merged.available, Tokens::Count(3));
    assert_eq!(merged.next_generation, limited.next_generation);
}

#[test]
fn two_unlimited_sides_stay_unlimited() {
    let unlimited = TokenRules {
        mode: TokenMode::Infinite,
        ..finite(0)
    }
    .available(start(), &[], after(1));

    assert_eq!(
        merge(unlimited, unlimited).available,
        Tokens::Infinite,
        "infinite tokens on both sides must not be read as a count of minus one"
    );
    assert!(merge(unlimited, unlimited).may_play());
}

#[test]
fn equal_balances_wait_for_the_later_generation() {
    let sooner = TokenRules {
        gen_initial: 2,
        gen_number: 1,
        gen_interval: Interval::from_seconds(600).expect("ten minutes"),
        ..finite(2)
    };
    let later = TokenRules {
        gen_interval: Interval::from_seconds(3_600).expect("an hour"),
        ..sooner
    };

    let sooner = sooner.available(start(), &[], after(1));
    let later = later.available(start(), &[], after(1));

    assert_eq!(sooner.available, later.available);
    assert_eq!(sooner.next_generation, Some(after(10)));
    assert_eq!(
        merge(sooner, later).next_generation,
        Some(after(60)),
        "with equal balances both must generate before a play"
    );
}

#[test]
fn an_equal_balance_with_one_set_still_generating_never_announces_one() {
    let generating = TokenRules {
        gen_number: 1,
        ..finite(2)
    }
    .available(start(), &[], after(1));
    let stopped = finite(2).available(start(), &[], after(1));

    assert_eq!(merge(generating, stopped).next_generation, None);
}
