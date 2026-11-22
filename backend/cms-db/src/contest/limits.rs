//! The resource-limit checks the `contests` table makes on top of its window
//! and token columns.
//!
//! Each refusal is one `CheckConstraint` at `src/cms/db/contest.py:235-318`, and
//! the comparison is the constraint's own: a nullable column that is absent
//! passes, because SQL treats the check as unknown rather than false.

use super::model::Contest;
use super::token::TokenConfigError;
use super::window::WindowError;

impl Contest {
    /// Refuse a limit column the table's check constraint refuses.
    pub(super) fn validate_limits(&self) -> Result<(), ContestError> {
        if self
            .per_user_time
            .is_some_and(|value| !value.is_non_negative())
        {
            return Err(column("per_user_time", ">= '0 seconds'"));
        }
        for (name, value) in [
            ("max_submission_number", self.max_submission_number),
            ("max_user_test_number", self.max_user_test_number),
        ] {
            if value.is_some_and(|value| value <= 0) {
                return Err(column(name, "> 0"));
            }
        }
        for (name, value) in [
            ("min_submission_interval", self.min_submission_interval),
            (
                "min_submission_interval_grace_period",
                self.min_submission_interval_grace_period,
            ),
            ("min_user_test_interval", self.min_user_test_interval),
        ] {
            if value.is_some_and(|value| !value.is_positive()) {
                return Err(column(name, "> '0 seconds'"));
            }
        }
        for (name, value) in [
            (
                "evaluation_throttle_delay_s",
                self.evaluation_throttle_delay_s,
            ),
            (
                "evaluation_throttle_window_s",
                self.evaluation_throttle_window_s,
            ),
            ("evaluation_throttle_max", self.evaluation_throttle_max),
            (
                "queue_fairness_penalty_seconds",
                self.queue_fairness_penalty_seconds,
            ),
            ("score_precision", self.score_precision),
        ] {
            if value < 0 {
                return Err(column(name, ">= 0"));
            }
        }
        Ok(())
    }
}

/// One refused column, named with the check it broke.
fn column(name: &'static str, requirement: &'static str) -> ContestError {
    ContestError::ColumnOutOfRange {
        column: name,
        requirement,
    }
}

/// Why a contest row violates one of its table's checks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum ContestError {
    /// One of the three window orderings does not hold.
    #[error(transparent)]
    Window(#[from] WindowError),
    /// One of the token checks does not hold.
    #[error(transparent)]
    Token(#[from] TokenConfigError),
    /// A limit column holds a value its check refuses.
    #[error("contests.{column} must be {requirement}")]
    ColumnOutOfRange {
        /// The column whose check failed.
        column: &'static str,
        /// The comparison the check makes.
        requirement: &'static str,
    },
}
