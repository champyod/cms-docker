//! The `freeze` override: the action the panel has always offered and the service used
//! to ignore.
//!
//! WHY these tests live here rather than in tests/overrides.rs: they exercise only the
//! fold (`Overrides::fold` / `frozen_at`), which needs no `Subchange` fixture. The
//! replay-side test — that a change after the cutoff never reaches the ledger — needs a
//! `Subchange`, and is recorded as unverified in
//! docs/IMPLEMENTATION-CHECKLIST-RANKING-SCOPE.md.

use cms_ranking::overrides::{OverrideRow, Overrides};

fn frozen(value: Option<&str>) -> Overrides {
    Overrides::fold(&[freeze_row(value)])
}

fn freeze_row(value: Option<&str>) -> OverrideRow {
    OverrideRow {
        target_kind: "user".to_string(),
        target_key: "u0".to_string(),
        action: "freeze".to_string(),
        payload: value.map(|value| serde_json::json!({ "value": value })),
    }
}

/// The regression this whole change exists for: `freeze` used to fall through the fold's
/// catch-all arm, so the panel reported success and the board did not move.
#[test]
fn freeze_is_a_known_action_and_stops_being_skipped() {
    let overrides = frozen(Some("1700000000"));
    assert_eq!(
        overrides.skipped(),
        0,
        "freeze must not be counted as an unreadable row"
    );
    assert_eq!(overrides.frozen_at(), Some(1_700_000_000));
}

/// A board with no freeze replays every subchange, which is the behaviour every existing
/// deployment already has.
#[test]
fn no_freeze_leaves_the_board_unfrozen() {
    let overrides = Overrides::fold(&[]);
    assert_eq!(overrides.frozen_at(), None);
    assert_eq!(overrides.skipped(), 0);
}

/// Projection time is whole seconds. A fractional cutoff is refused rather than
/// truncated, so a typo cannot silently freeze the board at an unintended instant.
#[test]
fn a_fractional_cutoff_is_refused_rather_than_truncated() {
    let overrides = frozen(Some("1700000000.5"));
    assert_eq!(overrides.frozen_at(), None);
    assert_eq!(overrides.skipped(), 1);
}

/// A freeze with no value is malformed: the payload requires a cutoff.
#[test]
fn a_freeze_without_a_value_is_skipped() {
    let overrides = frozen(None);
    assert_eq!(overrides.frozen_at(), None);
    assert_eq!(overrides.skipped(), 1);
}

/// A negative cutoff parses, and means "frozen from before the contest started" — every
/// change is held back. It is not an error, so it must not be counted as one.
#[test]
fn a_negative_cutoff_is_accepted() {
    let overrides = frozen(Some("-1"));
    assert_eq!(overrides.frozen_at(), Some(-1));
    assert_eq!(overrides.skipped(), 0);
}

/// Later rows win by position, which is how the table already resolves one action
/// superseding another: re-freezing later must move the cutoff, not be ignored.
#[test]
fn a_later_freeze_supersedes_an_earlier_one() {
    let overrides = Overrides::fold(&[freeze_row(Some("100")), freeze_row(Some("200"))]);
    assert_eq!(overrides.frozen_at(), Some(200));
    assert_eq!(overrides.skipped(), 0);
}
