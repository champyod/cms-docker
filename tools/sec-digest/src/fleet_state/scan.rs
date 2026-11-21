//! The nightly scan as one fact: a full result reads as one, and a gap is said out loud.
//!
//! The scanner publishes `/var/cache/security-scan/scan-status.json` on its cache volume; the
//! host probe passes that document through as `lastscan=`, and an older scanner's
//! `<timestamp>|<count>` log fact still renders, so a mixed deploy never reads as NOT REPORTED.

use chrono::{DateTime, NaiveDateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::timeutil::hours_since;

/// A nightly scan older than this means the cron inside the scanner stopped,
/// not that the host is clean.
pub const SCAN_STALE_HOURS: f64 = 30.0;
const SCAN_FORMAT: &str = "%Y-%m-%dT%H:%M:%SZ";
const NOT_REPORTED: &str = "scan: NOT REPORTED";

/// The scanner's run record. Every count is optional: a field the file omits is
/// not a zero, so it is omitted from the line rather than claimed.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct ScanResult {
    #[serde(default)]
    pub at: String,
    #[serde(default)]
    pub findings: Option<u64>,
    /// Findings carrying a published fix — the panel's own `available`, absent from an older file.
    #[serde(default)]
    pub fixable: Option<u64>,
    #[serde(default)]
    pub batches_sent: Option<u64>,
    #[serde(default)]
    pub batches_total: Option<u64>,
    #[serde(default)]
    pub batches_rejected: Option<u64>,
    #[serde(default)]
    pub complete: Option<bool>,
}

/// The host's last scan as one fact: missing, unreadable, incomplete or old is said out loud.
pub fn scan_line(raw: &str, now: DateTime<Utc>) -> String {
    let raw = raw.trim();
    if raw.is_empty() {
        return NOT_REPORTED.to_string();
    }
    if raw.starts_with('{') {
        // A file we cannot read is not a fact, so it reads as none — never as a healthy run.
        return match serde_json::from_str::<ScanResult>(raw) {
            Ok(result) => scan_result_line(&result, now),
            Err(_) => NOT_REPORTED.to_string(),
        };
    }
    legacy_line(raw, now)
}

/// `scan 2026-11-12 03:00 · 13,357 findings · 54/54 batches · 0 rejected`
fn scan_result_line(result: &ScanResult, now: DateTime<Utc>) -> String {
    let at = result.at.trim();
    if at.is_empty() {
        return NOT_REPORTED.to_string();
    }
    let mut bits = vec![format!("scan {}", short_stamp(at))];
    bits.push(format!(
        "{} findings",
        result
            .findings
            .map(group)
            .unwrap_or_else(|| "?".to_string())
    ));
    if let Some(fixable) = result.fixable {
        bits.push(format!("{} fixable", group(fixable)));
    }
    if let Some(total) = result.batches_total {
        bits.push(format!(
            "{}/{} batches",
            result.batches_sent.unwrap_or(0),
            total
        ));
    }
    if let Some(rejected) = result.batches_rejected {
        bits.push(format!("{rejected} rejected"));
    }
    if result.complete == Some(false) {
        bits.push("INCOMPLETE".to_string());
    }
    let fact = bits.join(" · ");
    if is_stale(at, now) {
        format!("{fact} · SCAN STALE")
    } else {
        fact
    }
}

/// The line the scanner has always logged: `<timestamp>|<count> findings`.
fn legacy_line(raw: &str, now: DateTime<Utc>) -> String {
    let (timestamp, count) = match raw.split_once('|') {
        Some((left, right)) => (left.trim(), right.trim()),
        None => (raw.trim(), ""),
    };
    let count = if count.is_empty() { "?" } else { count };
    let fact = format!("scan {timestamp} · {count} findings");
    if is_stale(timestamp, now) {
        format!("{fact} · SCAN STALE")
    } else {
        fact
    }
}

/// A timestamp nothing can parse is not called stale: it is left as the scanner wrote it.
fn is_stale(at: &str, now: DateTime<Utc>) -> bool {
    match NaiveDateTime::parse_from_str(at, SCAN_FORMAT) {
        Ok(then) => hours_since(then.and_utc(), now) > SCAN_STALE_HOURS,
        Err(_) => false,
    }
}

/// `2026-11-12T03:00:20Z` as `2026-11-12 03:00`: the minute is the precision a reader acts on.
fn short_stamp(at: &str) -> String {
    match at.get(..16) {
        Some(head) => head.replace('T', " "),
        None => at.to_string(),
    }
}

/// Thousands separators, because 13357 and 13,357 are read at different speeds.
fn group(value: u64) -> String {
    let digits = value.to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (index, ch) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index).is_multiple_of(3) {
            out.push(',');
        }
        out.push(ch);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::timeutil::parse_dt;

    fn clock() -> DateTime<Utc> {
        parse_dt("2026-11-12T09:00:00Z").expect("fixed clock")
    }

    fn result(json: &str) -> ScanResult {
        serde_json::from_str(json).expect("scan result parses")
    }

    #[test]
    fn a_complete_run_prints_its_findings_and_its_batches() {
        let fact = result(
            r#"{"at":"2026-11-12T03:00:20Z","findings":13357,"batches_sent":54,
                "batches_total":54,"batches_rejected":0,"complete":true}"#,
        );
        assert_eq!(
            scan_line(&serde_json::to_string(&fact).expect("round trip"), clock()),
            "scan 2026-11-12 03:00 · 13,357 findings · 54/54 batches · 0 rejected"
        );
    }

    #[test]
    fn a_file_that_omits_fixable_keeps_the_line_it_always_printed() {
        // An old scanner publishes no fixable count; claiming "0 fixable" would be a fact it never sent.
        assert_eq!(
            scan_line(
                r#"{"at":"2026-11-12T03:00:20Z","findings":13357,"batches_sent":54,"batches_total":54,"batches_rejected":0,"complete":true}"#,
                clock()
            ),
            "scan 2026-11-12 03:00 · 13,357 findings · 54/54 batches · 0 rejected"
        );
    }

    #[test]
    fn an_explicit_zero_fixable_is_printed_not_dropped() {
        let fact = result(
            r#"{"at":"2026-11-12T03:00:20Z","findings":13377,"fixable":0,"batches_sent":55,"batches_total":55,"batches_rejected":0}"#,
        );
        assert_eq!(
            scan_result_line(&fact, clock()),
            "scan 2026-11-12 03:00 · 13,377 findings · 0 fixable · 55/55 batches · 0 rejected"
        );
    }

    #[test]
    fn an_incomplete_run_says_so() {
        let fact = result(
            r#"{"at":"2026-11-12T03:00:20Z","findings":10,"batches_total":4,"batches_sent":1,"complete":false}"#,
        );
        let line = scan_line(&serde_json::to_string(&fact).expect("round trip"), clock());
        assert!(line.contains("1/4 batches"), "{line}");
        assert!(line.contains("INCOMPLETE"), "{line}");
    }

    #[test]
    fn a_refused_batch_is_counted_not_rounded_away() {
        let fact = result(
            r#"{"at":"2026-11-12T03:00:20Z","findings":900,"batches_total":4,"batches_sent":1,"batches_rejected":1,"complete":false}"#,
        );
        let line = scan_line(&serde_json::to_string(&fact).expect("round trip"), clock());
        assert!(line.contains("1 rejected"), "{line}");
    }

    #[test]
    fn a_stale_result_is_still_named_stale() {
        let fact = result(
            r#"{"at":"2026-11-10T03:00:20Z","findings":5,"batches_total":1,"batches_sent":1,"complete":true}"#,
        );
        let line = scan_line(&serde_json::to_string(&fact).expect("round trip"), clock());
        assert!(line.ends_with("SCAN STALE"), "{line}");
    }

    #[test]
    fn a_file_without_a_usable_time_is_not_reported() {
        assert_eq!(scan_line("{", clock()), NOT_REPORTED);
        assert_eq!(scan_line(r#"{"findings":5}"#, clock()), NOT_REPORTED);
        assert_eq!(scan_line("", clock()), NOT_REPORTED);
    }

    #[test]
    fn the_legacy_log_fact_still_renders() {
        assert_eq!(
            scan_line("2026-11-12T03:00:20Z|13357", clock()),
            "scan 2026-11-12T03:00:20Z · 13357 findings"
        );
        assert_eq!(
            scan_line("2026-11-12T03:00:20Z|", clock()),
            "scan 2026-11-12T03:00:20Z · ? findings"
        );
    }

    #[test]
    fn counts_are_grouped_by_thousands() {
        assert_eq!(group(0), "0");
        assert_eq!(group(999), "999");
        assert_eq!(group(1000), "1,000");
        assert_eq!(group(13357), "13,357");
        assert_eq!(group(1234567), "1,234,567");
    }
}
