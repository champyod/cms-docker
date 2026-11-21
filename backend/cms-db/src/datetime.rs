//! The timestamp column's two conversions, kept in the convention the schema
//! was filled under.
//!
//! `cms.db` stores every instant as a `timestamp without time zone` holding UTC,
//! and `cmscommon.datetime` is the only door between that column and a POSIX
//! second count. Two of its choices are load-bearing rather than incidental:
//!
//! - `make_timestamp` subtracts the **naive** epoch, so the wall clock is read
//!   as UTC. It is not `datetime.timestamp()`, which reads a naive datetime in
//!   the machine's own zone: the same datetime is 25 200 s apart between a
//!   Bangkok host and a UTC one, and the rows were written on both.
//! - `make_datetime(None)` is `datetime.utcnow()`, not `datetime.now()`, so a
//!   default fills the column with the instant rather than with local time.
//!
//! Both are reproduced here with [`chrono::NaiveDateTime`], the same
//! zone-less spelling the driver hands the column over as
//! (`cms_db::SubmissionRecord::timestamp`). No conversion in this module reads
//! the machine's zone, which is why the two tests that prove it start a child
//! process under `TZ=Asia/Bangkok`: on a UTC host the wrong implementation and
//! the right one return the same number.
//!
//! `get_timezone` and `get_system_timezone` have no counterpart here; the
//! reason is recorded on [`LOCAL_TZ`].

use chrono::{DateTime, Datelike, Local, NaiveDate, NaiveDateTime, Utc};

/// `cmscommon.datetime.EPOCH`: the naive epoch `make_timestamp` subtracts.
pub const EPOCH: NaiveDateTime = NaiveDate::from_ymd_opt(1970, 1, 1)
    .unwrap()
    .and_hms_opt(0, 0, 0)
    .unwrap();

/// `babel.dates.UTC`: the zone a stored instant is read in.
///
/// Named here so the two zones the system recognises have one home and a caller
/// cannot introduce a third by picking a type at hand.
pub const UTC: Utc = Utc;

/// `babel.dates.LOCALTZ`: the machine's own zone, used only for display.
///
/// This is the zone value, not the lookup. `get_timezone` (user → contest →
/// local, `src/cmscommon/datetime.py:77`) and `get_system_timezone`
/// (`src/cmscommon/datetime.py:100`) name a zone out of babel's database by
/// string; their only callers are the contest web server's handlers
/// (`src/cms/server/contest/handlers/contest.py:263`) and the functional test
/// runner (`src/cmstestsuite/testrunner.py:132`), both of which land in S-7/S-8
/// and S-12. Supplying them needs a timezone database crate, which is a new
/// dependency and therefore the operator's decision, not this slice's.
pub const LOCAL_TZ: Local = Local;

/// Why a timestamp could not become a datetime, naming the Python exception it
/// stands for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DateTimeError {
    /// NaN, which `utcfromtimestamp` refuses with `ValueError`, or an
    /// infinity, which it refuses with `OverflowError`.
    NotFinite,
    /// Outside the year range 1..=9999, which `utcfromtimestamp` refuses with
    /// `ValueError` (`datetime` has no year 0 or 10000).
    OutOfRange,
}

impl std::fmt::Display for DateTimeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFinite => write!(f, "timestamp is not a finite number"),
            Self::OutOfRange => write!(f, "timestamp is outside the year range 1..=9999"),
        }
    }
}

impl std::error::Error for DateTimeError {}

/// The datetime at `timestamp`, read as UTC: `make_datetime`.
///
/// `None` is the current instant in UTC, which is what
/// `datetime.utcnow()` returns and what the column's default expects; the
/// machine's zone never enters it.
///
/// # Errors
///
/// Returns [`DateTimeError::NotFinite`] for NaN or an infinity and
/// [`DateTimeError::OutOfRange`] outside the year range 1..=9999, the two
/// inputs `datetime.utcfromtimestamp` raises on rather than guessing at.
pub fn make_datetime(timestamp: Option<f64>) -> Result<NaiveDateTime, DateTimeError> {
    let Some(timestamp) = timestamp else {
        return Ok(Utc::now().naive_utc());
    };
    if !timestamp.is_finite() {
        return Err(DateTimeError::NotFinite);
    }
    let micros = micros_at(timestamp).ok_or(DateTimeError::OutOfRange)?;
    let datetime = DateTime::from_timestamp_micros(micros).ok_or(DateTimeError::OutOfRange)?;
    let naive = datetime.naive_utc();
    if !(1..=9999).contains(&naive.year()) {
        return Err(DateTimeError::OutOfRange);
    }
    Ok(naive)
}

/// The microsecond count of `timestamp`, rounded half to even.
///
/// # Why the split
///
/// `utcfromtimestamp` splits the double at the second, then rounds only the
/// fractional part to the microsecond, ties to even. Multiplying the whole
/// timestamp by 1e6 first rounds twice and moves `1.9999995` from 1 999 999 µs
/// to 2 000 000, which is one microsecond the original does not produce.
fn micros_at(timestamp: f64) -> Option<i64> {
    let whole = timestamp.trunc();
    // WHY: `as` saturates, so a timestamp past `i64` becomes `None` here rather
    // than wrapping into a year the original refuses.
    let seconds = i64::try_from(whole as i128).ok()?;
    let fraction = (timestamp - whole) * 1_000_000.0;
    let sub_micros = fraction.round_ties_even() as i64;
    seconds.checked_mul(1_000_000)?.checked_add(sub_micros)
}

/// The seconds between [`EPOCH`] and `dt`: `make_timestamp`.
///
/// `None` is the current instant, as `time.time()`.
///
/// The argument is [`NaiveDateTime`] because that is the whole domain of the
/// Python function: given an aware datetime it raises
/// `TypeError: can't subtract offset-naive and offset-aware datetimes` instead
/// of reinterpreting the offset, so a port that accepted one would have to
/// invent an answer for an input the original refuses.
#[must_use]
pub fn make_timestamp(dt: Option<NaiveDateTime>) -> f64 {
    let micros = match dt {
        None => Utc::now().timestamp_micros(),
        Some(dt) => dt.and_utc().timestamp_micros(),
    };
    // WHY: one integer division instead of summing `num_seconds` and a
    // fraction, so the float is the one `timedelta.total_seconds()` produces.
    micros as f64 / 1_000_000.0
}
