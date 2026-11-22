//! The `contests` declaration, and the window and token projections it carries.
//!
//! The fixture is a row the table would accept: defaults where a column has one,
//! a valid window, and no resource cap.

use cms_db::{
    ContestError, ContestWindow, Phase, TokenConfigError, TokenMode, TokenPolicy, WindowError,
    CONTEST,
};

// Each binary that includes this fixture uses a subset of it.
#[allow(dead_code)]
#[path = "support/contest_fixture.rs"]
mod contest_fixture;

use contest_fixture::{at, contest, seconds};

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
