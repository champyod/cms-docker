//! The two numbers a row shows beside a score: how long a run took, and how big it was.
//!
//! Both are the panel's own units rather than the score's: a duration is always milliseconds,
//! because two runs a tenth of a second apart are told apart by them, and a size steps up
//! through binary multiples, because that is what a memory limit is written in. A size keeps
//! three significant digits and no more, which is why a hundred bytes has none after the point
//! and a kibibyte has two.
//!
//! Nothing here rounds a score: a duration is shown as it was measured and a size as it was
//! allocated, and the only rounding is the digits the unit needs.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use super::format::{grouped, round_at};

/// What a second is called in the short form a report uses.
const SECONDS: &str = "sec";
/// The binary multiple a size steps up by, and the units it steps through.
const SIZE_STEP: f64 = 1024.0;
const SIZE_UNITS: [&str; 4] = ["KiB", "MiB", "GiB", "TiB"];

/// A duration in seconds, always with milliseconds, as a report shows it.
#[must_use]
pub fn format_duration(seconds: f64) -> String {
    if !seconds.is_finite() {
        return format!("{seconds} {SECONDS}");
    }
    format!("{} {SECONDS}", fixed(seconds.abs(), 3))
}

/// A size in bytes, in the largest binary unit that leaves the number under a thousand.
#[must_use]
pub fn format_size(bytes: i64) -> String {
    let mut size = (bytes as f64).abs();
    if size < SIZE_STEP {
        let whole = round_at(size, 0);
        let unit = if whole == 1.0 { "byte" } else { "bytes" };
        return format!("{} {unit}", fixed(whole, 0));
    }
    for unit in SIZE_UNITS {
        size /= SIZE_STEP;
        if size < SIZE_STEP {
            // The digits that keep three significant ones, and never a fraction of a byte.
            let places = (2.0 - size.log10().floor()).max(0.0) as usize;
            return format!("{} {unit}", fixed(size, places));
        }
    }
    format!("{} {}", fixed(size, 0), SIZE_UNITS[SIZE_UNITS.len() - 1])
}

/// A number with exactly `places` fraction digits, its thousands grouped.
fn fixed(value: f64, places: usize) -> String {
    let text = format!("{:.*}", places, value.abs());
    let (integer, fraction) = text.split_once('.').unwrap_or((&text, ""));
    let body = if fraction.is_empty() {
        grouped(integer)
    } else {
        format!("{}.{fraction}", grouped(integer))
    };
    if value < 0.0 {
        format!("-{body}")
    } else {
        body
    }
}
