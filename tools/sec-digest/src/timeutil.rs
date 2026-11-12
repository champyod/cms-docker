//! Dates as the feeds publish them, and the digest window.

use chrono::{DateTime, Duration, NaiveDate, NaiveDateTime, Utc};

pub fn now_utc() -> DateTime<Utc> {
    Utc::now()
}

/// `2026-11-12T03:00:20Z` — the shape the run record and the scan line use.
pub fn iso(dt: DateTime<Utc>) -> String {
    dt.format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

/// Parse the date shapes the feeds emit; `None` when it cannot be read.
///
/// A date that cannot be parsed is never guessed: the caller drops the item or
/// reports the feed, it does not get a made-up timestamp.
pub fn parse_dt(value: &str) -> Option<DateTime<Utc>> {
    let s = value.trim();
    if s.is_empty() {
        return None;
    }
    if let Ok(dt) = DateTime::parse_from_rfc3339(s) {
        return Some(dt.with_timezone(&Utc));
    }
    if let Ok(dt) = DateTime::parse_from_rfc2822(s) {
        return Some(dt.with_timezone(&Utc));
    }
    if let Some((date, rest)) = s.split_once(' ') {
        let joined = format!("{date}T{rest}");
        if let Ok(dt) = DateTime::parse_from_rfc3339(&joined) {
            return Some(dt.with_timezone(&Utc));
        }
    }
    for fmt in ["%Y-%m-%dT%H:%M:%S%.f%:z", "%Y-%m-%dT%H:%M:%S%.f"] {
        if let Ok(dt) = DateTime::parse_from_str(s, fmt) {
            return Some(dt.with_timezone(&Utc));
        }
        if let Ok(dt) = NaiveDateTime::parse_from_str(s, fmt) {
            return Some(dt.and_utc());
        }
    }
    for fmt in ["%Y-%m-%d", "%Y/%m/%d", "%d %b %Y"] {
        if let Ok(d) = NaiveDate::parse_from_str(s, fmt) {
            return Some(d.and_hms_opt(0, 0, 0)?.and_utc());
        }
    }
    None
}

/// Start of the window: `now - hours`.
pub fn since(now: DateTime<Utc>, hours: u32) -> DateTime<Utc> {
    now - Duration::hours(i64::from(hours))
}

/// Age in hours, used by the 30h scan-staleness rule.
pub fn hours_since(at: DateTime<Utc>, now: DateTime<Utc>) -> f64 {
    (now - at).num_seconds() as f64 / 3600.0
}
