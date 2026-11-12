//! The SERVER block's scan fact, end to end: the probe line in, one sentence out.
//!
//! A reader must be able to tell a healthy 13,357-finding nightly run from a dead scanner,
//! and a run the panel refused from one that landed. Every gap is named; none reads as clean.

use chrono::{DateTime, Utc};
use sec_digest::fleet_state::{as_lines_at, parse_probe, FleetState, ServerProbe};
use sec_digest::timeutil::parse_dt;

fn clock() -> DateTime<Utc> {
    parse_dt("2026-11-12T09:00:00Z").expect("fixed clock")
}

/// The line the SERVER block prints for one host, from the probe text that host answered.
fn server_line(probe_text: &str) -> String {
    let state = FleetState {
        servers: vec![parse_probe("como-main", probe_text)],
        ..FleetState::default()
    };
    as_lines_at(&state, clock()).1[0].clone()
}

const KERNEL: &str = "kernel=5.15.0-203-generic";

#[test]
fn a_full_result_names_findings_batches_and_rejections() {
    let line = server_line(&format!(
        "{KERNEL}\nlastscan={{\"at\":\"2026-11-12T03:00:20Z\",\"host\":\"cms\",\"findings\":13357,\
         \"batches_sent\":54,\"batches_total\":54,\"batches_rejected\":0,\"complete\":true}}"
    ));
    assert!(
        line.ends_with("scan 2026-11-12 03:00 · 13,357 findings · 54/54 batches · 0 rejected"),
        "{line}"
    );
    assert!(!line.contains("INCOMPLETE"), "{line}");
    assert!(!line.contains("STALE"), "{line}");
}

#[test]
fn an_incomplete_run_is_named_incomplete() {
    let line = server_line(&format!(
        "{KERNEL}\nlastscan={{\"at\":\"2026-11-12T03:00:20Z\",\"findings\":13357,\
         \"batches_sent\":54,\"batches_total\":54,\"batches_rejected\":0,\"complete\":false}}"
    ));
    assert!(line.contains("54/54 batches"), "{line}");
    assert!(line.ends_with("INCOMPLETE"), "{line}");
}

#[test]
fn a_refused_batch_is_counted_and_the_shortfall_is_visible() {
    let line = server_line(&format!(
        "{KERNEL}\nlastscan={{\"at\":\"2026-11-12T03:00:20Z\",\"findings\":13357,\
         \"batches_sent\":53,\"batches_total\":54,\"batches_rejected\":1,\"complete\":false}}"
    ));
    assert!(line.contains("53/54 batches"), "{line}");
    assert!(line.contains("1 rejected"), "{line}");
    assert!(line.contains("INCOMPLETE"), "{line}");
}

#[test]
fn a_missing_result_file_is_not_reported() {
    let line = server_line(KERNEL);
    assert!(line.contains("scan: NOT REPORTED"), "{line}");
}

#[test]
fn an_unreadable_result_file_is_not_reported_either() {
    let line = server_line(&format!("{KERNEL}\nlastscan={{\"at\":"));
    assert!(line.contains("scan: NOT REPORTED"), "{line}");
}

#[test]
fn a_stale_result_keeps_the_stale_wording() {
    let line = server_line(&format!(
        "{KERNEL}\nlastscan={{\"at\":\"2026-11-10T03:00:20Z\",\"findings\":13357,\
         \"batches_sent\":54,\"batches_total\":54,\"batches_rejected\":0,\"complete\":true}}"
    ));
    assert!(line.contains("13,357 findings"), "{line}");
    assert!(line.ends_with("SCAN STALE"), "{line}");
}

#[test]
fn the_older_scanner_log_fact_still_renders() {
    let line = server_line(&format!("{KERNEL}\nlastscan=2026-11-12T03:00:20Z|13357"));
    assert!(line.contains("scan 2026-11-12T03:00:20Z · 13357 findings"), "{line}");
    assert!(!line.contains("INCOMPLETE"), "{line}");
}

#[test]
fn a_file_without_counts_claims_none() {
    let probe = parse_probe(
        "como-main",
        "kernel=5.15.0-203-generic\nlastscan={\"at\":\"2026-11-12T03:00:20Z\",\"complete\":true}",
    );
    let state = FleetState {
        servers: vec![probe],
        ..FleetState::default()
    };
    let line = as_lines_at(&state, clock()).1[0].clone();
    assert!(line.contains("scan 2026-11-12 03:00 · ? findings"), "{line}");
    assert!(!line.contains("batches"), "{line}");
    assert!(!line.contains("rejected"), "{line}");
}

#[test]
fn a_server_that_cannot_be_reached_still_says_so() {
    let unreachable = ServerProbe {
        host: "admin".to_string(),
        error: Some("timed out".to_string()),
        ..ServerProbe::default()
    };
    let state = FleetState {
        servers: vec![unreachable],
        ..FleetState::default()
    };
    let line = as_lines_at(&state, clock()).1[0].clone();
    assert_eq!(line, "admin: UNREACHABLE — timed out");
}
