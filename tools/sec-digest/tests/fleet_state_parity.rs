//! Parity with tests/test_fleet_state.py: the probe parser and the scan line.
//!
//! A missing fact is not a good fact: an unreachable host, a stale scan and a
//! scan that never reported are each named.

mod common;

use sec_digest::fleet_state::{as_lines_at, parse_probe, scan_line, FleetState, ServerProbe};
use sec_digest::timeutil::{now_utc, parse_dt};

fn lines_for(probe: ServerProbe) -> String {
    let state = FleetState {
        servers: vec![probe],
        ..FleetState::default()
    };
    as_lines_at(&state, now_utc()).1[0].clone()
}

#[test]
fn reads_the_probe_contract() {
    let text = "kernel=5.15.0-203-generic\nreboot=required\nsecupdates=4\ndisk=38\n\
                containers=36\nunhealthy=1\nrestarting=0\nuptime=12345\ncms_backup_stale 1\n";
    let probe = parse_probe("como-main", text);
    assert_eq!(probe.kernel.as_deref(), Some("5.15.0-203-generic"));
    assert_eq!(probe.reboot.as_deref(), Some("required"));
    assert_eq!(probe.secupdates.as_deref(), Some("4"));
    assert_eq!(probe.backup_stale.as_deref(), Some("1"));
    assert_eq!(probe.uptime.as_deref(), Some("12345"));
    assert!(probe.extra.is_empty());
}

#[test]
fn timeout_is_reported_not_swallowed() {
    let probe = parse_probe("admin", "__error__ TimeoutExpired: 25s");
    assert!(probe.error.is_some());
    assert!(lines_for(probe).contains("UNREACHABLE"));
}

#[test]
fn last_scan_is_a_fact_never_silence() {
    let probe = parse_probe(
        "cms",
        "kernel=5.15.0-203-generic\nlastscan=2026-11-12T03:00:20Z|13357",
    );
    let line = lines_for(probe);
    assert!(line.contains("scan 2026-11-12T03:00:20Z · 13357 findings"));
    assert!(!line.contains("STALE"));
}

#[test]
fn a_scan_that_stopped_is_named() {
    let probe = parse_probe(
        "cms",
        "kernel=5.15.0-203-generic\nlastscan=2026-01-01T03:00:00Z|900",
    );
    assert!(lines_for(probe).contains("SCAN STALE"));
}

#[test]
fn a_missing_scan_is_not_clean() {
    let probe = parse_probe("cms", "kernel=5.15.0-203-generic");
    assert!(lines_for(probe).contains("scan: NOT REPORTED"));
}

#[test]
fn the_staleness_edge_is_thirty_hours() {
    let now = parse_dt("2026-11-12T09:00:00Z").expect("fixed clock");
    assert!(!scan_line("2026-11-11T03:30:00Z|10", now).contains("STALE"));
    assert!(scan_line("2026-11-11T02:30:00Z|10", now).contains("STALE"));
    assert_eq!(scan_line("", now), "scan: NOT REPORTED");
    assert_eq!(scan_line("2026-11-12T03:00:20Z|", now), "scan 2026-11-12T03:00:20Z · ? findings");
}
