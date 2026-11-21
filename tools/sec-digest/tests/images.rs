use chrono::{TimeZone, Utc};

use sec_digest::images::{line, parse, Verdict};

/// The digest line for the nightly image scan. These cases exist because that run had no human
/// surface at all: Issues are disabled, so a summary nobody opens was the whole story.
fn verdict(over: &str) -> Verdict {
    let json = format!(
        r#"{{"at":"2026-11-13T03:17:00Z","state":"findings","refs":13,"fixable":4,"drift":4,"unknown":0,"bumped":true,"pr":10{over}}}"#
    );
    parse(&json).expect("fixture parses")
}

fn now() -> chrono::DateTime<chrono::Utc> {
    Utc.with_ymd_and_hms(2026, 11, 13, 9, 0, 0).unwrap()
}

#[test]
fn an_actionable_run_says_act_now_and_names_the_pr() {
    let text = line(&verdict(""), now());
    assert!(text.contains("act now"), "got {text}");
    assert!(text.contains("4 fixable"), "got {text}");
    assert!(text.contains("4 drifted"), "got {text}");
    assert!(text.contains("PR #10 open"), "got {text}");
    assert!(text.contains("run 2026-11-13 03:17"), "got {text}");
}

#[test]
fn a_clean_run_earns_the_quiet_verdict_without_a_pr() {
    let json = r#"{"at":"2026-11-13T03:17:00Z","state":"clean","refs":13,"fixable":0,"drift":0,"unknown":0,"bumped":false,"pr":null}"#;
    let text = line(&parse(json).expect("parse"), now());
    assert!(text.contains("nothing to do"), "got {text}");
    assert!(!text.contains("PR #"), "a clean run must not name a PR: {text}");
}

#[test]
fn an_unjudged_run_is_never_reported_as_clean() {
    let json = r#"{"at":"2026-11-13T03:17:00Z","state":"incomplete","refs":0,"fixable":null,"drift":0,"unknown":0,"bumped":false,"pr":null}"#;
    let text = line(&parse(json).expect("parse"), now());
    assert!(text.contains("NOT JUDGED"), "got {text}");
    assert!(!text.contains("nothing to do"), "an unanswered run read as clean: {text}");
}

#[test]
fn an_old_run_says_it_is_stale() {
    let json = r#"{"at":"2026-11-10T03:17:00Z","state":"clean","refs":13,"fixable":0,"drift":0,"unknown":0,"bumped":false,"pr":null}"#;
    let text = line(&parse(json).expect("parse"), now());
    assert!(text.contains("STALE"), "got {text}");
}

#[test]
fn unreadable_registries_are_counted_not_hidden() {
    let json = r#"{"at":"2026-11-13T03:17:00Z","state":"clean","refs":13,"fixable":0,"drift":0,"unknown":3,"bumped":false,"pr":null}"#;
    let text = line(&parse(json).expect("parse"), now());
    assert!(text.contains("3 unreadable"), "got {text}");
}

#[test]
fn a_missing_field_is_an_error_not_a_zero() {
    let json = r#"{"at":"2026-11-13T03:17:00Z","state":"clean"}"#;
    assert!(parse(json).is_err(), "a partial verdict must not parse");
}

#[test]
fn actionability_follows_findings_or_drift() {
    assert!(verdict("").actionable(), "findings and drift are actionable");
    let quiet = r#"{"at":"2026-11-13T03:17:00Z","state":"clean","refs":13,"fixable":0,"drift":0,"unknown":0,"bumped":false,"pr":null}"#;
    assert!(!parse(quiet).expect("parse").actionable());
}
