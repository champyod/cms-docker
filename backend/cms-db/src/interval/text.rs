//! Text form of an `interval`, as Postgres writes it back out.
//!
//! The driver decodes `INTERVAL` from the binary layout whenever the query was
//! prepared, and from this text form when it was not, so the two have to agree.
//! The default `postgres` output style writes a duration that has no month as a
//! `HH:MM:SS` clock, optionally preceded by a day count, with each component
//! carrying its own sign, and shows a fraction only in the seconds field; that
//! is the whole grammar accepted here. A year or a month is reported rather than
//! approximated, because the Python side has no `timedelta` for one.

use crate::interval::{Interval, IntervalError, MICROS_PER_DAY, MICROS_PER_SECOND};

const MICROS_PER_CLOCK_MINUTE: i64 = 60 * MICROS_PER_SECOND;
const MICROS_PER_CLOCK_HOUR: i64 = 60 * MICROS_PER_CLOCK_MINUTE;
const CLOCK_RADIX: i64 = 60;
const FRACTIONAL_DIGITS: usize = 6;
const MAX_CLOCK_HOURS: i64 = 24;

/// How long one `<quantity> <unit>` term is, or that it has no fixed length.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Unit {
    Day,
    Hour,
    Minute,
    Second,
    Year,
    Month,
}

impl Unit {
    /// The unit a name stands for, matched longest spelling first.
    fn of(name: &str) -> Result<Self, IntervalError> {
        match name.as_bytes() {
            b"d" | b"day" | b"days" => Ok(Self::Day),
            b"h" | b"hr" | b"hrs" | b"hour" | b"hours" => Ok(Self::Hour),
            b"m" | b"min" | b"mins" | b"minute" | b"minutes" => Ok(Self::Minute),
            b"s" | b"sec" | b"secs" | b"second" | b"seconds" => Ok(Self::Second),
            b"y" | b"yr" | b"yrs" | b"year" | b"years" => Ok(Self::Year),
            b"mon" | b"mons" | b"month" | b"months" => Ok(Self::Month),
            _ => Err(IntervalError::Malformed {
                term: name.to_string(),
            }),
        }
    }

    /// The term's length in microseconds, or a refusal for a calendar field.
    const fn micros(self) -> Result<i64, IntervalError> {
        match self {
            Self::Day => Ok(MICROS_PER_DAY),
            Self::Hour => Ok(MICROS_PER_CLOCK_HOUR),
            Self::Minute => Ok(MICROS_PER_CLOCK_MINUTE),
            Self::Second => Ok(MICROS_PER_SECOND),
            Self::Year => Err(IntervalError::CalendarField { unit: "year" }),
            Self::Month => Err(IntervalError::CalendarField { unit: "mon" }),
        }
    }
}

/// Parses the text form of an `interval`.
///
/// # Errors
///
/// Returns [`IntervalError`] for text that is not an interval, for a term that
/// is neither a clock nor a whole quantity with a unit, and for a year or month.
pub fn parse_interval_text(text: &str) -> Result<Interval, IntervalError> {
    let body = unadorned(text)?;
    Ok(Interval::from_micros(sum_terms(body)?))
}

/// Strips the optional `@` prefix and rejects text with nothing left.
fn unadorned(text: &str) -> Result<&str, IntervalError> {
    let trimmed = text.trim();
    let body = trimmed.strip_prefix('@').unwrap_or(trimmed).trim();
    if body.is_empty() {
        return Err(IntervalError::Empty);
    }
    Ok(body)
}

/// Adds up a whitespace-separated term list.
fn sum_terms(body: &str) -> Result<i64, IntervalError> {
    let terms: Vec<&str> = body.split_whitespace().collect();
    let mut total: i64 = 0;
    let mut index = 0;
    while index < terms.len() {
        let (value, width) = term(&terms, index)?;
        total = total.checked_add(value).ok_or(IntervalError::OutOfRange)?;
        index += width;
    }
    Ok(total)
}

/// Reads one term, reporting how many tokens it consumed.
///
/// A clock stands alone, and a whole quantity in front of one is a day count,
/// which is the shortened form the SQL standard style writes.
fn term(terms: &[&str], index: usize) -> Result<(i64, usize), IntervalError> {
    let token = terms[index];
    if token.contains(':') {
        return Ok((clock(token)?, 1));
    }
    let quantity = quantity(token)?;
    if terms.get(index + 1).is_some_and(|unit| unit.contains(':')) {
        return Ok((scaled(quantity, MICROS_PER_DAY)?, 1));
    }
    let unit = terms
        .get(index + 1)
        .copied()
        .ok_or_else(|| IntervalError::Malformed {
            term: token.to_string(),
        })?;
    Ok((scaled(quantity, Unit::of(unit)?.micros()?)?, 2))
}

/// Reads a `HH:MM:SS` clock, where a leading sign covers the whole clock.
fn clock(token: &str) -> Result<i64, IntervalError> {
    let (is_negative, body) = split_sign(token.strip_prefix('+').unwrap_or(token));
    let parts: Vec<&str> = body.split(':').collect();
    if !(2..=3).contains(&parts.len()) {
        return Err(IntervalError::Malformed {
            term: token.to_string(),
        });
    }
    let hours = bounded(parts[0], MAX_CLOCK_HOURS)?;
    let minutes = bounded(parts[1], CLOCK_RADIX - 1)?;
    let seconds = seconds_field(parts.get(2).copied().unwrap_or("0"))?;
    let total = MICROS_PER_CLOCK_HOUR * hours + MICROS_PER_CLOCK_MINUTE * minutes + seconds;
    Ok(if is_negative { -total } else { total })
}

fn split_sign(token: &str) -> (bool, &str) {
    token
        .strip_prefix('-')
        .map_or((false, token), |rest| (true, rest))
}

/// Reads a clock field and refuses anything outside `0..=highest`.
fn bounded(field: &str, highest: i64) -> Result<i64, IntervalError> {
    let value = quantity(field)?;
    let fits = (0..=highest).contains(&value);
    if fits {
        return Ok(value);
    }
    Err(IntervalError::Malformed {
        term: field.to_string(),
    })
}

/// Reads the seconds field, whose fraction becomes whole microseconds.
///
/// The fraction is read digit by digit rather than through a decimal, so the
/// value the column stores is the value that comes back out.
fn seconds_field(field: &str) -> Result<i64, IntervalError> {
    let (whole, fraction) = field.split_once('.').unwrap_or((field, ""));
    let micros = fraction_micros(fraction)?;
    let total = quantity(whole)?
        .checked_mul(MICROS_PER_SECOND)
        .and_then(|whole| whole.checked_add(micros))
        .ok_or(IntervalError::OutOfRange)?;
    if total / MICROS_PER_SECOND < CLOCK_RADIX {
        return Ok(total);
    }
    Err(IntervalError::Malformed {
        term: field.to_string(),
    })
}

/// Right-pads the fraction to the six digits the column stores, so that `03.45`
/// and `03.450000` read the same and neither needs a decimal to be placed.
fn fraction_micros(fraction: &str) -> Result<i64, IntervalError> {
    if fraction.len() > FRACTIONAL_DIGITS {
        return Err(IntervalError::Malformed {
            term: fraction.to_string(),
        });
    }
    let width = FRACTIONAL_DIGITS;
    let padded = format!("{fraction:0<width$}");
    quantity(&padded)
}

/// Reads a decimal quantity, which the output style writes with a sign of its
/// own, and refuses a fraction or anything that is not a digit.
fn quantity(text: &str) -> Result<i64, IntervalError> {
    let (is_negative, digits) = split_sign(text);
    if digits.is_empty() || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(IntervalError::Malformed {
            term: text.to_string(),
        });
    }
    let magnitude: i64 = digits.parse().map_err(|_| IntervalError::Malformed {
        term: text.to_string(),
    })?;
    Ok(if is_negative { -magnitude } else { magnitude })
}

fn scaled(quantity: i64, micros_per_unit: i64) -> Result<i64, IntervalError> {
    quantity
        .checked_mul(micros_per_unit)
        .ok_or(IntervalError::OutOfRange)
}
