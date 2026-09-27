//! Fixed-length mapping for the `interval` columns.
//!
//! `contests` and `tasks` hold submission throttles, token regeneration periods
//! and per-user budgets in `interval` columns, and `cms.db.base` maps that
//! column onto Python's `timedelta`. A `timedelta` counts a fixed number of
//! microseconds, so this mapping keeps only the fields that have a fixed length
//! and refuses the calendar ones rather than guessing how long they are.
//!
//! The value is a whole number of microseconds, which is the resolution the
//! column itself stores. One integer also makes the ordering a plain integer
//! comparison, so no two distinct durations can be settled equal by rounding.

use std::fmt;

use chrono::Duration;
use sqlx::postgres::types::PgInterval;

use self::text::parse_interval_text;

mod text;
mod wire;

/// Microseconds in one second, the resolution an `interval` column stores.
pub const MICROS_PER_SECOND: i64 = 1_000_000;

/// Microseconds in one minute.
pub const MICROS_PER_MINUTE: i64 = 60 * MICROS_PER_SECOND;

/// Microseconds in one hour.
pub const MICROS_PER_HOUR: i64 = 60 * MICROS_PER_MINUTE;

/// Microseconds in one day.
pub const MICROS_PER_DAY: i64 = 24 * MICROS_PER_HOUR;

const NANOS_PER_MICRO: i64 = 1_000;
const BYTES_PER_PG_INTERVAL: usize = 16;

/// Why an interval could not be mapped.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IntervalError {
    /// The text held nothing but an optional `@` prefix.
    Empty,
    /// A term was neither a `HH:MM:SS` clock nor a whole quantity with a unit.
    Malformed {
        /// The term that could not be read.
        term: String,
    },
    /// A year or month was present, which has no fixed length in seconds.
    CalendarField {
        /// The calendar unit that was found.
        unit: &'static str,
    },
    /// The binary field was not the sixteen bytes an `interval` occupies.
    BinaryLength {
        /// How many bytes the field actually held.
        found: usize,
    },
    /// The value does not fit the microsecond range.
    OutOfRange,
    /// The value is finer than the microsecond the column stores.
    SubMicrosecond,
}

impl fmt::Display for IntervalError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Empty => write!(f, "interval text is empty"),
            Self::Malformed { term } => write!(f, "interval term `{term}` is not readable"),
            Self::CalendarField { unit } => {
                write!(f, "interval field `{unit}` has no fixed length in seconds")
            }
            Self::BinaryLength { found } => {
                write!(
                    f,
                    "interval field of {found} bytes is not the expected {BYTES_PER_PG_INTERVAL}"
                )
            }
            Self::OutOfRange => write!(f, "interval is out of the microsecond range"),
            Self::SubMicrosecond => write!(f, "interval is finer than one microsecond"),
        }
    }
}

impl std::error::Error for IntervalError {}

/// An `interval` value reduced to a whole number of microseconds.
///
/// Ordering is the total order on that integer, so sorting contest throttles
/// cannot be settled equal by a rounding artefact.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Interval {
    microseconds: i64,
}

impl Interval {
    /// The zero interval, the default `token_min_interval`.
    #[must_use]
    pub const fn zero() -> Self {
        Self { microseconds: 0 }
    }

    /// An interval of exactly `microseconds` microseconds.
    #[must_use]
    pub const fn from_micros(microseconds: i64) -> Self {
        Self { microseconds }
    }

    /// An interval of a whole number of seconds, which is how the admin panel
    /// configures every one of these columns.
    ///
    /// # Errors
    ///
    /// Returns [`IntervalError::OutOfRange`] when the seconds do not fit the
    /// microsecond range, rather than wrapping onto a different interval.
    pub fn from_seconds(seconds: i64) -> Result<Self, IntervalError> {
        seconds
            .checked_mul(MICROS_PER_SECOND)
            .map(Self::from_micros)
            .ok_or(IntervalError::OutOfRange)
    }

    /// The interval in whole microseconds.
    #[must_use]
    pub const fn as_micros(self) -> i64 {
        self.microseconds
    }

    /// The interval in whole seconds, dropping any sub-second part.
    #[must_use]
    pub const fn whole_seconds(self) -> i64 {
        self.microseconds / MICROS_PER_SECOND
    }

    /// The interval from the `timedelta` the Python side hands over.
    ///
    /// # Errors
    ///
    /// Returns [`IntervalError::OutOfRange`] when the duration does not fit in
    /// microseconds and [`IntervalError::SubMicrosecond`] when it is finer than
    /// the column holds, which is the driver's own rule for this conversion.
    pub fn from_duration(value: Duration) -> Result<Self, IntervalError> {
        let micros = value.num_microseconds().ok_or(IntervalError::OutOfRange)?;
        let nanos = value.num_nanoseconds().ok_or(IntervalError::OutOfRange)?;
        if nanos % NANOS_PER_MICRO != 0 {
            return Err(IntervalError::SubMicrosecond);
        }
        Ok(Self::from_micros(micros))
    }

    /// The interval as the `timedelta` the Python side expects.
    #[must_use]
    pub const fn to_duration(self) -> Duration {
        Duration::microseconds(self.microseconds)
    }

    /// Reduces the three fields a driver hands over to a fixed length.
    ///
    /// # Errors
    ///
    /// Returns [`IntervalError::CalendarField`] when a month is present, since
    /// the Python side has no way to hold one, and [`IntervalError::OutOfRange`]
    /// when the day and time fields overflow together.
    pub fn from_pg(value: PgInterval) -> Result<Self, IntervalError> {
        if value.months != 0 {
            return Err(IntervalError::CalendarField { unit: "mon" });
        }
        let total = i64::from(value.days)
            .checked_mul(MICROS_PER_DAY)
            .and_then(|days| days.checked_add(value.microseconds))
            .ok_or(IntervalError::OutOfRange)?;
        Ok(Self::from_micros(total))
    }

    /// The three fields a driver binds, with no month.
    ///
    /// # Errors
    ///
    /// Returns [`IntervalError::OutOfRange`] when the whole-day part is larger
    /// than the `int32` the column's day field holds.
    pub fn to_pg(self) -> Result<PgInterval, IntervalError> {
        let days = i32::try_from(self.microseconds.div_euclid(MICROS_PER_DAY))
            .map_err(|_| IntervalError::OutOfRange)?;
        Ok(PgInterval {
            months: 0,
            days,
            microseconds: self.microseconds.rem_euclid(MICROS_PER_DAY),
        })
    }

    /// Whether the `>= '0 seconds'` check constraints accept this value.
    #[must_use]
    pub const fn is_non_negative(self) -> bool {
        self.microseconds >= 0
    }

    /// Whether the `> '0 seconds'` check constraints accept this value.
    #[must_use]
    pub const fn is_positive(self) -> bool {
        self.microseconds > 0
    }
}

impl std::str::FromStr for Interval {
    type Err = IntervalError;

    /// # Errors
    ///
    /// Returns [`IntervalError`] for any text that is not an interval, which
    /// covers an empty string, an unreadable term, and a year or month field.
    fn from_str(text: &str) -> Result<Self, Self::Err> {
        parse_interval_text(text)
    }
}
