//! The `contests` row, its window, and its token configuration.
//!
//! `src/cms/db/contest.py:46-387` is one table: identity, the flags that decide
//! what a contestant may do, the token columns, the time window and the resource
//! limits. Every field here is one column, in declaration order, so a row maps
//! onto the struct without a choice to make.
//!
//! The two behaviours the reference puts on the class are kept: [`Contest::phase`]
//! answers the window's phase, and the token columns are read as a
//! [`TokenPolicy`] so the check constraints and the mode's grant are asked in one
//! place. [`Contest::validate`] collects the table's checks, which the reference
//! left to the database.

use chrono::NaiveDateTime;

use crate::codename::Codename;
use crate::interval::Interval;

use super::limits::ContestError;
use super::token::{TokenMode, TokenPolicy};
use super::window::{ContestWindow, Phase};

/// A row of `contests`.
#[derive(Debug, Clone, PartialEq)]
pub struct Contest {
    /// `contests.id`.
    pub id: i32,
    /// `contests.name`, unique and drawn from the `CODENAME` domain.
    pub name: Codename,
    /// `contests.description`, the human-readable name.
    pub description: String,
    /// `contests.allowed_localizations`; empty means every localization.
    pub allowed_localizations: Vec<String>,
    /// `contests.languages`, the languages contestants may submit in.
    pub languages: Vec<String>,
    /// `contests.submissions_download_allowed`.
    pub submissions_download_allowed: bool,
    /// `contests.allow_questions`, whether the question interface is open.
    pub allow_questions: bool,
    /// `contests.allow_user_tests`, whether the user-test interface is open.
    pub allow_user_tests: bool,
    /// `contests.allow_unofficial_submission_before_analysis_mode`.
    pub allow_unofficial_submission_before_analysis_mode: bool,
    /// `contests.block_hidden_participations`, which keeps hidden users out.
    pub block_hidden_participations: bool,
    /// `contests.allow_password_authentication`.
    pub allow_password_authentication: bool,
    /// `contests.allow_registration`, whether new users may register.
    pub allow_registration: bool,
    /// `contests.ip_restriction`, whether a participation's subnet is enforced.
    pub ip_restriction: bool,
    /// `contests.ip_autologin`, whether a matching address logs in on arrival.
    pub ip_autologin: bool,
    /// `contests.token_mode`.
    pub token_mode: TokenMode,
    /// `contests.token_max_number`, or no total cap.
    pub token_max_number: Option<i32>,
    /// `contests.token_min_interval`.
    pub token_min_interval: Interval,
    /// `contests.token_gen_initial`.
    pub token_gen_initial: i32,
    /// `contests.token_gen_number`.
    pub token_gen_number: i32,
    /// `contests.token_gen_interval`.
    pub token_gen_interval: Interval,
    /// `contests.token_gen_max`, or no accrual cap.
    pub token_gen_max: Option<i32>,
    /// `contests.start`, the first instant the contest is open.
    pub start: NaiveDateTime,
    /// `contests.stop`, the last instant the contest is open.
    pub stop: NaiveDateTime,
    /// `contests.analysis_enabled`.
    pub analysis_enabled: bool,
    /// `contests.analysis_start`, the first instant analysis is open.
    pub analysis_start: NaiveDateTime,
    /// `contests.analysis_stop`, the last instant analysis is open.
    pub analysis_stop: NaiveDateTime,
    /// `contests.timezone`, an IANA zone name.
    pub timezone: Option<String>,
    /// `contests.per_user_time`, the USACO-style individual budget.
    pub per_user_time: Option<Interval>,
    /// `contests.max_submission_number`, or no cap.
    pub max_submission_number: Option<i32>,
    /// `contests.max_user_test_number`, or no cap.
    pub max_user_test_number: Option<i32>,
    /// `contests.min_submission_interval`, or no minimum.
    pub min_submission_interval: Option<Interval>,
    /// `contests.min_submission_interval_grace_period`, or no grace.
    pub min_submission_interval_grace_period: Option<Interval>,
    /// `contests.min_user_test_interval`, or no minimum.
    pub min_user_test_interval: Option<Interval>,
    /// `contests.evaluation_throttle_delay_s`.
    pub evaluation_throttle_delay_s: i32,
    /// `contests.evaluation_throttle_window_s`.
    pub evaluation_throttle_window_s: i32,
    /// `contests.evaluation_throttle_max`.
    pub evaluation_throttle_max: i32,
    /// `contests.evaluation_final_open`, the manual final-round bypass.
    pub evaluation_final_open: bool,
    /// `contests.evaluation_final_open_at`, when the bypass was enabled.
    pub evaluation_final_open_at: Option<NaiveDateTime>,
    /// `contests.queue_fairness_penalty_seconds`, the legacy throttle.
    pub queue_fairness_penalty_seconds: i32,
    /// `contests.score_precision`, the decimal places a score is rounded to.
    pub score_precision: i32,
    /// `contests.is_active`, whether this is the contest the stack serves.
    pub is_active: bool,
}

impl Contest {
    /// The window columns as the value that computes the phase.
    #[must_use]
    pub const fn window(&self) -> ContestWindow {
        ContestWindow {
            start: self.start,
            stop: self.stop,
            analysis_enabled: self.analysis_enabled,
            analysis_start: self.analysis_start,
            analysis_stop: self.analysis_stop,
        }
    }

    /// The token columns as the value that validates them and reads the mode.
    #[must_use]
    pub const fn token_policy(&self) -> TokenPolicy {
        TokenPolicy {
            mode: self.token_mode,
            max_number: self.token_max_number,
            min_interval: self.token_min_interval,
            gen_initial: self.token_gen_initial,
            gen_number: self.token_gen_number,
            gen_interval: self.token_gen_interval,
            gen_max: self.token_gen_max,
        }
    }

    /// The phase `at` falls in; see [`ContestWindow::phase`].
    #[must_use]
    pub fn phase(&self, at: NaiveDateTime) -> Phase {
        self.window().phase(at)
    }

    /// Refuse a row one of the table's check constraints refuses.
    ///
    /// # Errors
    ///
    /// Returns [`ContestError`] naming the window order, token column, or
    /// resource-limit column that violates its check.
    pub fn validate(&self) -> Result<(), ContestError> {
        self.window().validate()?;
        self.token_policy().validate()?;
        self.validate_limits()
    }
}
