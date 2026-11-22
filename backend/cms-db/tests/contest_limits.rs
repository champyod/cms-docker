//! The resource-limit checks the `contests` table makes, refused through the row.
//!
//! Each test breaks one column of a row the table would otherwise accept and
//! expects the check that column carries.

use cms_db::{ContestError, Interval};

// Each binary that includes this fixture uses a subset of it.
#[allow(dead_code)]
#[path = "support/contest_fixture.rs"]
mod contest_fixture;

use contest_fixture::{contest, seconds};

#[test]
fn a_negative_per_user_budget_is_refused() {
    let mut contest = contest();
    contest.per_user_time = Some(seconds(-1));

    assert_eq!(
        contest.validate(),
        Err(ContestError::ColumnOutOfRange {
            column: "per_user_time",
            requirement: ">= '0 seconds'",
        })
    );
}

#[test]
fn a_zero_submission_cap_is_refused() {
    let mut contest = contest();
    contest.max_submission_number = Some(0);

    assert_eq!(
        contest.validate(),
        Err(ContestError::ColumnOutOfRange {
            column: "max_submission_number",
            requirement: "> 0",
        })
    );
}

#[test]
fn a_zero_user_test_cap_is_refused() {
    let mut contest = contest();
    contest.max_user_test_number = Some(0);

    assert_eq!(
        contest.validate(),
        Err(ContestError::ColumnOutOfRange {
            column: "max_user_test_number",
            requirement: "> 0",
        })
    );
}

#[test]
fn a_zero_submission_interval_is_refused() {
    let mut contest = contest();
    contest.min_submission_interval = Some(Interval::zero());

    assert_eq!(
        contest.validate(),
        Err(ContestError::ColumnOutOfRange {
            column: "min_submission_interval",
            requirement: "> '0 seconds'",
        })
    );
}

#[test]
fn a_zero_submission_grace_period_is_refused() {
    let mut contest = contest();
    contest.min_submission_interval_grace_period = Some(Interval::zero());

    assert_eq!(
        contest.validate(),
        Err(ContestError::ColumnOutOfRange {
            column: "min_submission_interval_grace_period",
            requirement: "> '0 seconds'",
        })
    );
}

#[test]
fn a_zero_user_test_interval_is_refused() {
    let mut contest = contest();
    contest.min_user_test_interval = Some(Interval::zero());

    assert_eq!(
        contest.validate(),
        Err(ContestError::ColumnOutOfRange {
            column: "min_user_test_interval",
            requirement: "> '0 seconds'",
        })
    );
}

#[test]
fn a_negative_throttle_delay_is_refused() {
    let mut contest = contest();
    contest.evaluation_throttle_delay_s = -1;

    assert_eq!(
        contest.validate(),
        Err(ContestError::ColumnOutOfRange {
            column: "evaluation_throttle_delay_s",
            requirement: ">= 0",
        })
    );
}

#[test]
fn a_negative_throttle_window_is_refused() {
    let mut contest = contest();
    contest.evaluation_throttle_window_s = -1;

    assert_eq!(
        contest.validate(),
        Err(ContestError::ColumnOutOfRange {
            column: "evaluation_throttle_window_s",
            requirement: ">= 0",
        })
    );
}

#[test]
fn a_negative_throttle_maximum_is_refused() {
    let mut contest = contest();
    contest.evaluation_throttle_max = -1;

    assert_eq!(
        contest.validate(),
        Err(ContestError::ColumnOutOfRange {
            column: "evaluation_throttle_max",
            requirement: ">= 0",
        })
    );
}

#[test]
fn a_negative_fairness_penalty_is_refused() {
    let mut contest = contest();
    contest.queue_fairness_penalty_seconds = -1;

    assert_eq!(
        contest.validate(),
        Err(ContestError::ColumnOutOfRange {
            column: "queue_fairness_penalty_seconds",
            requirement: ">= 0",
        })
    );
}

#[test]
fn a_negative_score_precision_is_refused() {
    let mut contest = contest();
    contest.score_precision = -1;

    assert_eq!(
        contest.validate(),
        Err(ContestError::ColumnOutOfRange {
            column: "score_precision",
            requirement: ">= 0",
        })
    );
}
