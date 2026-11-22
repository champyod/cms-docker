//! Every edge of `Contest.phase`, pinned one instant at a time.
//!
//! The reference compares `timestamp < start`, `timestamp <= stop`,
//! `timestamp < analysis_start` and `timestamp <= analysis_stop`
//! (`src/cms/db/contest.py:378-386`). Each comparison gets a test on the instant
//! itself and on the microsecond beside it, because a flipped operator opens or
//! closes a contest early.

use chrono::{Duration, NaiveDate, NaiveDateTime};
use cms_db::{ContestWindow, Phase, WindowError};

/// The day every fixture sits on.
fn at(hour: u32, minute: u32, second: u32) -> NaiveDateTime {
    instant(2026, 11, 22, hour, minute, second)
}

/// One instant, built from its parts.
fn instant(year: i32, month: u32, day: u32, hour: u32, minute: u32, second: u32) -> NaiveDateTime {
    NaiveDate::from_ymd_opt(year, month, day)
        .and_then(|date| date.and_hms_opt(hour, minute, second))
        .expect("fixture time is valid")
}

/// A contest open from 09:00 to 12:00, with analysis from 13:00 to 14:00.
fn window(analysis_enabled: bool) -> ContestWindow {
    ContestWindow {
        start: at(9, 0, 0),
        stop: at(12, 0, 0),
        analysis_enabled,
        analysis_start: at(13, 0, 0),
        analysis_stop: at(14, 0, 0),
    }
}

/// The instant one microsecond before `instant`, the finest boundary the column
/// can hold.
fn just_before(instant: NaiveDateTime) -> NaiveDateTime {
    instant - Duration::microseconds(1)
}

/// The instant one microsecond after `instant`.
fn just_after(instant: NaiveDateTime) -> NaiveDateTime {
    instant + Duration::microseconds(1)
}

#[test]
fn before_start_is_not_started() {
    let window = window(true);

    assert_eq!(window.phase(just_before(window.start)), Phase::NotStarted);
}

#[test]
fn start_instant_opens_the_contest() {
    let window = window(true);

    assert_eq!(window.phase(window.start), Phase::Active);
}

#[test]
fn the_instant_before_stop_is_active() {
    let window = window(true);

    assert_eq!(window.phase(just_before(window.stop)), Phase::Active);
}

#[test]
fn stop_instant_is_still_active() {
    let window = window(true);

    assert_eq!(window.phase(window.stop), Phase::Active);
}

#[test]
fn the_instant_after_stop_waits_for_analysis() {
    let window = window(true);

    assert_eq!(
        window.phase(just_after(window.stop)),
        Phase::WaitingForAnalysis
    );
}

#[test]
fn analysis_start_instant_opens_analysis() {
    let window = window(true);

    assert_eq!(window.phase(window.analysis_start), Phase::Analysis);
}

#[test]
fn the_instant_before_analysis_start_waits() {
    let window = window(true);

    assert_eq!(
        window.phase(just_before(window.analysis_start)),
        Phase::WaitingForAnalysis
    );
}

#[test]
fn analysis_stop_instant_is_still_analysis() {
    let window = window(true);

    assert_eq!(window.phase(window.analysis_stop), Phase::Analysis);
}

#[test]
fn the_instant_after_analysis_stop_ends() {
    let window = window(true);

    assert_eq!(window.phase(just_after(window.analysis_stop)), Phase::Ended);
}

#[test]
fn a_disabled_analysis_window_ends_right_after_stop() {
    let window = window(false);

    assert_eq!(window.phase(just_after(window.stop)), Phase::Ended);
}

#[test]
fn phase_codes_match_the_reference_integers() {
    assert_eq!(Phase::NotStarted.code(), -1);
    assert_eq!(Phase::Active.code(), 0);
    assert_eq!(Phase::WaitingForAnalysis.code(), 1);
    assert_eq!(Phase::Analysis.code(), 2);
    assert_eq!(Phase::Ended.code(), 3);
}

#[test]
fn a_window_closing_before_it_opens_is_refused() {
    let mut window = window(true);
    window.stop = just_before(window.start);

    assert_eq!(window.validate(), Err(WindowError::StopBeforeStart));
}

#[test]
fn analysis_opening_before_the_contest_closes_is_refused() {
    let mut window = window(true);
    window.analysis_start = just_before(window.stop);

    assert_eq!(window.validate(), Err(WindowError::AnalysisStartBeforeStop));
}

#[test]
fn analysis_closing_before_it_opens_is_refused() {
    let mut window = window(true);
    window.analysis_stop = just_before(window.analysis_start);

    assert_eq!(
        window.validate(),
        Err(WindowError::AnalysisStopBeforeAnalysisStart)
    );
}

#[test]
fn the_column_defaults_are_a_valid_window() {
    let window = ContestWindow::default();

    assert_eq!(window.validate(), Ok(()));
    assert_eq!(window.phase(instant(2000, 1, 1, 0, 0, 0)), Phase::Active);
    assert_eq!(window.phase(instant(2030, 1, 1, 0, 0, 0)), Phase::Active);
    assert_eq!(window.phase(instant(2030, 1, 1, 0, 0, 1)), Phase::Ended);
}
