//! Per-contest token configuration and the check constraints it must satisfy.
//!
//! `Contest.token_mode` (`src/cms/db/contest.py:149-160`) is a Postgres enum over
//! three values, and the surrounding integer and interval columns carry the
//! `CheckConstraint`s at `contest.py:52-57` and `164-198`. The enum refuses any
//! other spelling, including `mixed`, which the server derives from the task
//! modes at render time and never stores.
//!
//! The modes constrain the contest differently (`src/cms/server/contest/tokening.py:98-104`):
//! `disabled` issues no token at all, `infinite` always issues one without
//! consulting the counters, and `finite` accrues them from `gen_initial` every
//! `gen_interval` up to `gen_max`. [`TokenGrant`] is that distinction, and
//! [`TokenPolicy::grant`] reads it off the mode.
//!
//! The database checks every column whatever the mode is, so [`TokenPolicy::validate`]
//! does too: an `infinite` contest with `token_max_number = 0` is still refused,
//! because the reference's `INSERT` would be.

use crate::interval::Interval;

pub use crate::token_mode::{TokenGrant, TokenMode};

/// The `contests` token columns as one value.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TokenPolicy {
    /// `contests.token_mode`.
    pub mode: TokenMode,
    /// `contests.token_max_number`: total plays allowed, or no cap.
    pub max_number: Option<i32>,
    /// `contests.token_min_interval`: time between two plays.
    pub min_interval: Interval,
    /// `contests.token_gen_initial`: tokens at the start.
    pub gen_initial: i32,
    /// `contests.token_gen_number`: tokens per generation period.
    pub gen_number: i32,
    /// `contests.token_gen_interval`: length of one period.
    pub gen_interval: Interval,
    /// `contests.token_gen_max`: cap on accrued tokens, or no cap.
    pub gen_max: Option<i32>,
}

impl TokenPolicy {
    /// How the configured mode answers a token request.
    #[must_use]
    pub const fn grant(&self) -> TokenGrant {
        self.mode.grant()
    }

    /// Refuse a configuration one of the token check constraints refuses.
    ///
    /// # Errors
    ///
    /// Returns the [`TokenConfigError`] variant naming the column and value that
    /// the corresponding `CheckConstraint` would have rejected.
    pub fn validate(&self) -> Result<(), TokenConfigError> {
        if let Some(found) = self.max_number.filter(|value| *value <= 0) {
            return Err(TokenConfigError::MaxNumberNotPositive { found });
        }
        if !self.min_interval.is_non_negative() {
            return Err(TokenConfigError::MinIntervalNegative);
        }
        if self.gen_initial < 0 {
            return Err(TokenConfigError::GenInitialNegative {
                found: self.gen_initial,
            });
        }
        if self.gen_number < 0 {
            return Err(TokenConfigError::GenNumberNegative {
                found: self.gen_number,
            });
        }
        if !self.gen_interval.is_positive() {
            return Err(TokenConfigError::GenIntervalNotPositive);
        }
        if let Some(found) = self.gen_max.filter(|value| *value <= 0) {
            return Err(TokenConfigError::GenMaxNotPositive { found });
        }
        if let Some(max) = self.gen_max.filter(|max| self.gen_initial > *max) {
            return Err(TokenConfigError::GenInitialAboveMax {
                initial: self.gen_initial,
                max,
            });
        }
        Ok(())
    }
}

impl Default for TokenPolicy {
    /// The column defaults: infinite, no caps, 2 tokens every 30 minutes.
    fn default() -> Self {
        Self {
            mode: TokenMode::Infinite,
            max_number: None,
            min_interval: Interval::zero(),
            gen_initial: 2,
            gen_number: 2,
            gen_interval: Interval::from_seconds(30 * 60)
                .expect("half an hour fits the interval column"),
            gen_max: None,
        }
    }
}

/// Why a token configuration violates a `contests` check constraint.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum TokenConfigError {
    /// `token_max_number > 0` does not hold.
    #[error("contests.token_max_number must be greater than 0, found {found}")]
    MaxNumberNotPositive {
        /// The refused value.
        found: i32,
    },
    /// `token_min_interval >= '0 seconds'` does not hold.
    #[error("contests.token_min_interval must not be negative")]
    MinIntervalNegative,
    /// `token_gen_initial >= 0` does not hold.
    #[error("contests.token_gen_initial must not be negative, found {found}")]
    GenInitialNegative {
        /// The refused value.
        found: i32,
    },
    /// `token_gen_number >= 0` does not hold.
    #[error("contests.token_gen_number must not be negative, found {found}")]
    GenNumberNegative {
        /// The refused value.
        found: i32,
    },
    /// `token_gen_interval > '0 seconds'` does not hold.
    #[error("contests.token_gen_interval must be greater than zero")]
    GenIntervalNotPositive,
    /// `token_gen_max > 0` does not hold.
    #[error("contests.token_gen_max must be greater than 0, found {found}")]
    GenMaxNotPositive {
        /// The refused value.
        found: i32,
    },
    /// `token_gen_initial <= token_gen_max` does not hold.
    #[error(
        "contests.token_gen_initial ({initial}) must not exceed contests.token_gen_max ({max})"
    )]
    GenInitialAboveMax {
        /// The initial count.
        initial: i32,
        /// The cap it exceeds.
        max: i32,
    },
}
