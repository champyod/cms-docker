//! The four timestamps that open and close a contest, and the phase they imply.
//!
//! `Contest.phase` (`src/cms/db/contest.py:366-387`) answers one of five phases
//! for an instant, and its comparison operators are the whole rule:
//!
//! | instant | answer |
//! |---|---|
//! | `at < start` | not started |
//! | `at <= stop` | active |
//! | analysis disabled, past `stop` | ended |
//! | `at < analysis_start` | waiting for analysis |
//! | `at <= analysis_stop` | analysis |
//! | later | ended |
//!
//! Both the opening of the contest and the opening of analysis are reached at
//! the exact timestamp, and both closings stay active through their own instant.
//! An off-by-one on either side opens or closes the window early, so each edge is
//! pinned by a test.
//!
//! The ordering checks are the table's own (`src/cms/db/contest.py:52-57`):
//! `start <= stop <= analysis_start <= analysis_stop`, enforced whether or not
//! analysis is enabled. [`ContestWindow::validate`] refuses the same four
//! orderings, so a window the table would reject is rejected here first.

use chrono::{NaiveDate, NaiveDateTime};

/// Which part of a contest's life an instant falls in.
///
/// The discriminants are the integers `Contest.phase` returns, kept so a caller
/// that exchanges the phase with the Python side sends the same number.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[repr(i8)]
pub enum Phase {
    /// Before `start`: the contest is not open.
    NotStarted = -1,
    /// From `start` through `stop`, both included: the contest is open.
    Active = 0,
    /// Past `stop` and before `analysis_start`: submissions are closed and the
    /// analysis window has not opened.
    WaitingForAnalysis = 1,
    /// From `analysis_start` through `analysis_stop`, both included: analysis
    /// mode is open.
    Analysis = 2,
    /// Past the last window the contest has, or past `stop` when analysis is
    /// disabled.
    Ended = 3,
}

impl Phase {
    /// The integer `Contest.phase` returns for this phase.
    #[must_use]
    pub const fn code(self) -> i8 {
        self as i8
    }
}

/// The `contests` timestamps and the flag that gives the analysis pair meaning.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ContestWindow {
    /// `contests.start`: the first instant the contest is open.
    pub start: NaiveDateTime,
    /// `contests.stop`: the last instant the contest is open.
    pub stop: NaiveDateTime,
    /// `contests.analysis_enabled`: whether the analysis pair is consulted.
    pub analysis_enabled: bool,
    /// `contests.analysis_start`: the first instant analysis is open.
    pub analysis_start: NaiveDateTime,
    /// `contests.analysis_stop`: the last instant analysis is open.
    pub analysis_stop: NaiveDateTime,
}

impl ContestWindow {
    /// The phase `at` falls in, reproducing `Contest.phase` comparison for
    /// comparison.
    ///
    /// The analysis pair is consulted only when analysis is enabled; a contest
    /// that never enables it is ended from the instant after `stop`.
    #[must_use]
    pub fn phase(&self, at: NaiveDateTime) -> Phase {
        if at < self.start {
            return Phase::NotStarted;
        }
        if at <= self.stop {
            return Phase::Active;
        }
        if self.analysis_enabled {
            if at < self.analysis_start {
                return Phase::WaitingForAnalysis;
            }
            if at <= self.analysis_stop {
                return Phase::Analysis;
            }
        }
        Phase::Ended
    }

    /// Refuse an ordering the `contests` check constraints refuse.
    ///
    /// # Errors
    ///
    /// Returns [`WindowError::StopBeforeStart`] for `stop < start`,
    /// [`WindowError::AnalysisStartBeforeStop`] for `analysis_start < stop`, and
    /// [`WindowError::AnalysisStopBeforeAnalysisStart`] for the last pair, which
    /// are the table's three ordering checks.
    pub fn validate(&self) -> Result<(), WindowError> {
        if self.stop < self.start {
            return Err(WindowError::StopBeforeStart);
        }
        if self.analysis_start < self.stop {
            return Err(WindowError::AnalysisStartBeforeStop);
        }
        if self.analysis_stop < self.analysis_start {
            return Err(WindowError::AnalysisStopBeforeAnalysisStart);
        }
        Ok(())
    }
}

impl Default for ContestWindow {
    /// The column defaults: open since 2000, closed in 2030, analysis off.
    fn default() -> Self {
        Self {
            start: midnight(2000, 1, 1),
            stop: midnight(2030, 1, 1),
            analysis_enabled: false,
            analysis_start: midnight(2030, 1, 1),
            analysis_stop: midnight(2030, 1, 1),
        }
    }
}

/// Why a window violates one of the table's ordering checks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum WindowError {
    /// `start <= stop` does not hold.
    #[error("contests.start must not be after contests.stop")]
    StopBeforeStart,
    /// `stop <= analysis_start` does not hold.
    #[error("contests.stop must not be after contests.analysis_start")]
    AnalysisStartBeforeStop,
    /// `analysis_start <= analysis_stop` does not hold.
    #[error("contests.analysis_start must not be after contests.analysis_stop")]
    AnalysisStopBeforeAnalysisStart,
}

/// Midnight on a date the reference names as a column default.
fn midnight(year: i32, month: u32, day: u32) -> NaiveDateTime {
    NaiveDate::from_ymd_opt(year, month, day)
        .and_then(|date| date.and_hms_opt(0, 0, 0))
        .expect("the reference's default date is a valid midnight")
}
