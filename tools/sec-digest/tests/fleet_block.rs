//! Parity with the FleetBlock tests: facts render, and a gap is never health.

mod common;

use std::fs;

use chrono::DateTime;
use sec_digest::fleet_state::{as_lines_at, FleetState, RepoState, ServerProbe, Waivers};
use sec_digest::render::fleet_block_at;
use sec_digest::timeutil::parse_dt;

fn fixtures() -> FleetState {
    let text = fs::read_to_string("tests/fixtures/fleet_state.json").expect("fleet fixture");
    serde_json::from_str(&text).expect("fleet fixture parses")
}

fn clock() -> DateTime<chrono::Utc> {
    parse_dt("2026-11-12T09:00:00Z").expect("fixed test clock")
}

#[test]
fn facts_render_and_never_claim_health() {
    let block = fleet_block_at(&fixtures(), clock());
    assert!(block.starts_with("## REPO"));
    assert!(block.contains("## SERVER"));
    assert!(block.contains("3 uncommitted"));
    assert!(block.contains("REBOOT REQUIRED"));
    assert!(block.contains("1 UNHEALTHY"));
    assert!(block.contains("backup STALE"));
    assert!(block.contains("1 EXPIRED"));
    assert!(block.contains("- cms-learn: checkout not found"));
}

#[test]
fn repo_and_server_lines_are_exact() {
    let (repos, servers) = as_lines_at(&fixtures(), clock());
    assert_eq!(
        repos[0],
        "cms-docker @ major/admin-panel a57f0856 (2 days ago) · 3 uncommitted · CI success (CI) · 1 open PR(s): Sync constraints"
    );
    assert_eq!(repos[2], "waivers: 18 live, next review 2027-01-31, 1 EXPIRED");
    assert_eq!(
        servers[0],
        "como-main: kernel 5.15.0-203-generic · REBOOT REQUIRED · 4 pending security update(s) · disk 38% · 36 containers up · 1 UNHEALTHY · backup STALE · scan 2026-11-12T03:00:20Z · 13357 findings"
    );
    assert_eq!(servers[2], "not probed (no route configured): cms, ranking");
}

#[test]
fn a_stale_dump_set_renders_its_age() {
    let mut state = fixtures();
    state.servers[0].backup_stale = None;
    state.servers[0].backup_dump_age_days = Some("19".into());
    let (_, servers) = as_lines_at(&state, clock());
    assert!(
        servers[0].contains("backup 19d old"),
        "a 19-day-old dump must say so: {}",
        servers[0]
    );
}

#[test]
fn a_host_with_no_backup_fact_says_not_reported() {
    let mut state = fixtures();
    state.servers[0].backup_stale = None;
    state.servers[0].backup_dump_age_days = None;
    state.servers[0].backup_not_reported = Some("1".into());
    let (_, servers) = as_lines_at(&state, clock());
    assert!(
        servers[0].contains("backup NOT REPORTED"),
        "silence was the bug; this host must name it: {}",
        servers[0]
    );
}

#[test]
fn a_fresh_dump_adds_nothing() {
    let mut state = fixtures();
    state.servers[0].backup_stale = None;
    state.servers[0].backup_dump_age_days = Some("0".into());
    let (_, servers) = as_lines_at(&state, clock());
    assert!(!servers[0].contains("backup"), "{}", servers[0]);
}

#[test]
fn unreachable_host_is_not_healthy() {
    let state = FleetState {
        repos: Vec::new(),
        servers: vec![ServerProbe {
            host: "admin".to_string(),
            error: Some("timed out".to_string()),
            ..ServerProbe::default()
        }],
        waivers: None,
        errors: Vec::new(),
        uncovered: vec!["cms".to_string(), "ranking".to_string()],
    };
    let block = fleet_block_at(&state, clock());
    assert!(block.contains("UNREACHABLE"));
    assert!(!block.contains("containers up"));
    assert!(block.contains("not probed"));
}

#[test]
fn an_empty_state_says_nothing_read_instead_of_ok() {
    let block = fleet_block_at(&FleetState::default(), clock());
    assert_eq!(block, "## REPO\nnothing read\n## SERVER\nnothing read");
}

#[test]
fn zero_dirty_and_zero_expired_add_no_noise() {
    let state = FleetState {
        repos: vec![RepoState {
            repo: "cms-docker".to_string(),
            branch: "main".to_string(),
            head: "abc1234".to_string(),
            age: "1 hour ago".to_string(),
            ..RepoState::default()
        }],
        waivers: Some(Waivers {
            count: 2,
            next: String::new(),
            expired: 0,
        }),
        ..FleetState::default()
    };
    let (repos, _) = as_lines_at(&state, clock());
    assert_eq!(repos[0], "cms-docker @ main abc1234 (1 hour ago)");
    assert_eq!(repos[1], "waivers: 2 live, next review ?");
}
