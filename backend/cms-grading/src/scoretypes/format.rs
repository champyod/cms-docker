//! How a score becomes the text a contestant and an administrator are shown.
//!
//! Every rule here is a rule about a number that was already decided: the score is the
//! score type's, and this module only says what it looks like. That matters because a score
//! that is right and shown wrong is still wrong, and each of these numbers has a decimal
//! rule behind it that a plain formatting call does not reproduce.
//!
//! The rounding rounds the exact value the storage holds. Python's `round` does, and
//! multiplying by a power of ten first does not: `2.675` scaled by a hundred is the double
//! `267.5` exactly, whose tie goes to even and yields `2.68`, while the value really held is
//! `2.67499…`, which is `2.67`. A published score changes either way, so the rounding is done
//! on the digits of the value rather than on a product of it.
//!
//! Ties go to even, as Python's `round` sends them. Two places round: the score's own
//! precision, and the three fractional digits the panel's decimal pattern shows. The ranking
//! string is neither: it is C's `%g`, six significant digits, because the ranking server
//! reads the number rather than the sentence. Durations and sizes are [`crate::scoretypes::units`].

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::cmp::Ordering;

/// The fractional digits the panel's decimal pattern shows, however precise the score.
const SHOWN_FRACTION_DIGITS: usize = 3;
/// The significant digits `%g` keeps, which is C's default precision.
const GENERAL_DIGITS: usize = 6;
/// The exponents `%g` uses the fixed form between: below the low one and from the high one
/// it writes an exponent instead.
const GENERAL_LOW_EXPONENT: i32 = -4;
const GENERAL_HIGH_EXPONENT: i32 = 6;

/// The value rounded to `precision` decimal places, ties to even, as Python's `round`.
#[must_use]
pub fn round_at(value: f64, precision: u32) -> f64 {
    if !value.is_finite() {
        return value;
    }
    // Rust's conversion rounds the exact binary value, which is what Python's round does.
    format!("{:.*}", precision as usize, value)
        .parse()
        .unwrap_or(value)
}

/// A score as the panel shows it: grouped thousands, at most three fraction digits.
#[must_use]
pub fn format_decimal(value: f64) -> String {
    if !value.is_finite() {
        return format_general(value);
    }
    // Babel rounds the shortest decimal that reads back as this double, not the binary value.
    let shortest = format!("{value}");
    let rounded = round_digits(&shortest, SHOWN_FRACTION_DIGITS);
    let negative = rounded.starts_with('-');
    let unsigned = rounded.trim_start_matches('-');
    let (integer, fraction) = unsigned.split_once('.').unwrap_or((unsigned, ""));
    let fraction = fraction.trim_end_matches('0');
    let body = if fraction.is_empty() {
        grouped(integer)
    } else {
        format!("{}.{fraction}", grouped(integer))
    };
    if negative {
        format!("-{body}")
    } else {
        body
    }
}

/// A score as the ranking server reads it, which is C's `%g` with six digits.
#[must_use]
pub fn format_general(value: f64) -> String {
    if value == 0.0 {
        return "0".to_owned();
    }
    if !value.is_finite() {
        return format!("{value}");
    }
    let sign = if value < 0.0 { "-" } else { "" };
    let (digits, exponent) = significant(format!("{:.5e}", value.abs()));
    let body = if !(GENERAL_LOW_EXPONENT..GENERAL_HIGH_EXPONENT).contains(&exponent) {
        let digits = digits.trim_end_matches('0');
        let mantissa = if digits.len() > 1 {
            format!("{}.{}", &digits[..1], &digits[1..])
        } else {
            digits.to_owned()
        };
        format!(
            "{mantissa}e{}{:02}",
            if exponent < 0 { '-' } else { '+' },
            exponent.abs()
        )
    } else {
        fixed_digits(&digits, GENERAL_DIGITS as i32 - 1 - exponent)
    };
    format!("{sign}{body}")
}

/// The string a submission's score is shown as: the rounded score out of the maximum.
#[must_use]
pub fn format_score(score: f64, max_score: f64, precision: u32) -> String {
    format!(
        "{} / {}",
        format_decimal(round_at(score, precision)),
        format_decimal(round_at(max_score, precision))
    )
}

/// The integer part with a comma every three digits.
pub(super) fn grouped(integer: &str) -> String {
    let mut grouped = String::with_capacity(integer.len() + integer.len() / 3);
    for (position, digit) in integer.char_indices() {
        if position > 0 && (integer.len() - position).is_multiple_of(3) {
            grouped.push(',');
        }
        grouped.push(digit);
    }
    grouped
}

/// The decimal text rounded to `places` fraction digits, ties to even.
fn round_digits(text: &str, places: usize) -> String {
    let (sign, unsigned) = match text.strip_prefix('-') {
        Some(rest) => ("-", rest),
        None => ("", text),
    };
    let (integer, fraction) = unsigned.split_once('.').unwrap_or((unsigned, ""));
    if fraction.len() <= places {
        return text.to_owned();
    }
    let mut digits: Vec<u8> = format!("{integer}{}", &fraction[..places]).into_bytes();
    if rounds_up(fraction.as_bytes(), places) {
        carry(&mut digits);
    }
    let split = digits.len() - places;
    let integer = String::from_utf8_lossy(&digits[..split]).into_owned();
    let fraction = String::from_utf8_lossy(&digits[split..]).into_owned();
    if fraction.is_empty() {
        format!("{sign}{integer}")
    } else {
        format!("{sign}{integer}.{fraction}")
    }
}

/// Whether the digits cut at `places` round away, which a tie sends to the even side.
fn rounds_up(fraction: &[u8], places: usize) -> bool {
    match fraction[places].cmp(&b'5') {
        Ordering::Greater => true,
        Ordering::Less => false,
        Ordering::Equal => {
            let beyond = fraction[places + 1..].iter().any(|digit| *digit != b'0');
            let last_kept = if places == 0 {
                None
            } else {
                Some(fraction[places - 1])
            };
            beyond || last_kept.is_some_and(|digit| (digit - b'0') % 2 == 1)
        }
    }
}

/// Adds one to a decimal written as digits, carrying through the nines.
fn carry(digits: &mut Vec<u8>) {
    for digit in digits.iter_mut().rev() {
        if *digit == b'9' {
            *digit = b'0';
        } else {
            *digit += 1;
            return;
        }
    }
    digits.insert(0, b'1');
}

/// The six significant digits and the exponent of a `{:e}` rendering of a positive value.
fn significant(scientific: String) -> (String, i32) {
    let (mantissa, exponent) = scientific
        .split_once('e')
        .expect("a {:e} rendering always names an exponent");
    let digits: String = mantissa.chars().filter(char::is_ascii_digit).collect();
    let exponent = exponent
        .parse()
        .expect("a {:e} rendering always names a number");
    (digits, exponent)
}

/// Six significant digits written without an exponent, `places` of them fractional.
fn fixed_digits(digits: &str, places: i32) -> String {
    if places <= 0 {
        let whole = &digits[..digits.len().saturating_sub(places.unsigned_abs() as usize)];
        return whole.trim_end_matches('0').to_owned();
    }
    let places = places as usize;
    let (whole, fraction) = if digits.len() > places {
        digits.split_at(digits.len() - places)
    } else {
        ("", digits)
    };
    let whole = if whole.is_empty() { "0" } else { whole };
    let padding = places.saturating_sub(fraction.len());
    let fraction = format!("{}{fraction}", "0".repeat(padding));
    let fraction = fraction.trim_end_matches('0');
    if fraction.is_empty() {
        whole.to_owned()
    } else {
        format!("{whole}.{fraction}")
    }
}
