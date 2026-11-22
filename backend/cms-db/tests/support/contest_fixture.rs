//! A contest row inside every check, and the window projection it carries.

use chrono::{NaiveDate, NaiveDateTime};
use cms_db::{Codename, Contest, ContestWindow, Interval, TokenMode};

/// A whole number of seconds.
pub fn seconds(value: i64) -> Interval {
    Interval::from_seconds(value).expect("fixture seconds fit the interval column")
}

/// One instant, built from its parts.
pub fn instant(year: i32, month: u32, day: u32, hour: u32, minute: u32) -> NaiveDateTime {
    NaiveDate::from_ymd_opt(year, month, day)
        .and_then(|date| date.and_hms_opt(hour, minute, 0))
        .expect("fixture time is valid")
}

/// One instant on the day the contest fixtures sit on.
pub fn at(hour: u32, minute: u32) -> NaiveDateTime {
    instant(2026, 11, 22, hour, minute)
}

/// The window the contest fixture carries.
pub fn window() -> ContestWindow {
    ContestWindow {
        start: at(9, 0),
        stop: at(12, 0),
        analysis_enabled: true,
        analysis_start: at(13, 0),
        analysis_stop: at(14, 0),
    }
}

/// A contest row inside every check.
pub fn contest() -> Contest {
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
