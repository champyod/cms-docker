//! The `contests` row: its declaration, its window and token projections, and
//! every limit check the reference left to the database.
//!
//! The fixture is a row the table would accept: defaults where a column has one,
//! a valid window, and no resource cap. Each test breaks one column and expects
//! the check that column carries.

use chrono::{NaiveDate, NaiveDateTime};
use cms_db::{
    Codename, Contest, ContestError, ContestWindow, Interval, Phase, TokenConfigError, TokenMode,
    TokenPolicy, WindowError, CONTEST,
};

/// A whole number of seconds.
fn seconds(value: i64) -> Interval {
    Interval::from_seconds(value).expect("fixture seconds fit the interval column")
}

/// One instant, built from its parts.
fn at(hour: u32, minute: u32) -> NaiveDateTime {
    NaiveDate::from_ymd_opt(2026, 11, 22)
        .and_then(|date| date.and_hms_opt(hour, minute, 0))
        .expect("fixture time is valid")
}

/// A contest row inside every check.
fn contest() -> Contest {
    Contest {
        id: 1,
        name: Codename::parse("weekly").expect("fixture name is a codename"),
        description: "Weekly contest".to_string(),
        allowed_localizations: Vec::new(),
        languages: vec!["C++20 / g++".to_string()],
        submissions_download_allowed: true,
        allow_questions: true,
        allow_user_tests: true,
        allow_unofficial_submission_before_analysis_mode: false,
        block_hidden_participations: false,
        allow_password_authentication: true,
        allow_registration: false,
        ip_restriction: true,
        ip_autologin: false,
        token_mode: TokenMode::Finite,
        token_max_number: Some(4),
        token_min_interval: seconds(60),
        token_gen_initial: 2,
        token_gen_number: 1,
        token_gen_interval: seconds(600),
        token_gen_max: Some(3),
        start: at(9, 0),
        stop: at(12, 0),
        analysis_enabled: true,
        analysis_start: at(13, 0),
        analysis_stop: at(14, 0),
        timezone: Some("Asia/Bangkok".to_string()),
        per_user_time: None,
        max_submission_number: None,
        max_user_test_number: None,
        min_submission_interval: None,
        min_submission_interval_grace_period: None,
        min_user_test_interval: None,
        evaluation_throttle_delay_s: 0,
        evaluation_throttle_window_s: 0,
        evaluation_throttle_max: 0,
        evaluation_final_open: false,
        evaluation_final_open_at: None,
        queue_fairness_penalty_seconds: 0,
        score_precision: 0,
        is_active: true,
    }
}

#[test]
fn the_declaration_describes_the_table() {
    assert_eq!(CONTEST.validate(), Ok(()));
    assert_eq!(CONTEST.table, "contests");
    assert_eq!(CONTEST.columns.len(), 41);
    assert_eq!(CONTEST.value_columns().count(), 40);
}

#[test]
fn the_fixture_is_a_row_the_table_accepts() {
    assert_eq!(contest().validate(), Ok(()));
}

#[test]
fn the_window_and_tokens_are_projected_from_their_columns() {
    let contest = contest();

    assert_eq!(
        contest.window(),
        ContestWindow {
            start: at(9, 0),
            stop: at(12, 0),
            analysis_enabled: true,
            analysis_start: at(13, 0),
            analysis_stop: at(14, 0),
        }
    );
    assert_eq!(
        contest.token_policy(),
        TokenPolicy {
            mode: TokenMode::Finite,
            max_number: Some(4),
            min_interval: seconds(60),
            gen_initial: 2,
            gen_number: 1,
            gen_interval: seconds(600),
            gen_max: Some(3),
        }
    );
}

#[test]
fn the_phase_is_the_windows_phase() {
    let contest = contest();

    assert_eq!(contest.phase(at(8, 59)), Phase::NotStarted);
    assert_eq!(contest.phase(at(9, 0)), Phase::Active);
    assert_eq!(contest.phase(at(12, 0)), Phase::Active);
    assert_eq!(contest.phase(at(12, 1)), Phase::WaitingForAnalysis);
    assert_eq!(contest.phase(at(13, 0)), Phase::Analysis);
    assert_eq!(contest.phase(at(14, 0)), Phase::Analysis);
    assert_eq!(contest.phase(at(14, 1)), Phase::Ended);
}

#[test]
fn a_backwards_window_is_refused_through_the_model() {
    let mut contest = contest();
    contest.stop = at(8, 0);

    assert_eq!(
        contest.validate(),
        Err(ContestError::Window(WindowError::StopBeforeStart))
    );
}

#[test]
fn a_backwards_analysis_window_is_refused_through_the_model() {
    let mut contest = contest();
    contest.analysis_stop = at(12, 30);

    assert_eq!(
        contest.validate(),
        Err(ContestError::Window(
            WindowError::AnalysisStopBeforeAnalysisStart
        ))
    );
}

#[test]
fn a_bad_token_cap_is_refused_through_the_model() {
    let mut contest = contest();
    contest.token_gen_max = Some(1);

    assert_eq!(
        contest.validate(),
        Err(ContestError::Token(TokenConfigError::GenInitialAboveMax {
            initial: 2,
            max: 1,
        }))
    );
}

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
