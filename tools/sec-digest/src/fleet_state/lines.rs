//! Plain-text fleet lines: no model, no interpretation, no claimed health.

use chrono::{DateTime, Utc};

use crate::timeutil::now_utc;

use super::{scan_line, FleetState, RepoState, ServerProbe};

fn or_unknown(value: &str) -> &str {
    if value.is_empty() {
        "?"
    } else {
        value
    }
}

fn is_set(value: &Option<String>) -> bool {
    matches!(value.as_deref(), Some(text) if !text.is_empty() && text != "0")
}

fn repo_line(repo: &RepoState) -> String {
    let mut bits = vec![format!(
        "{} @ {} {} ({})",
        repo.repo,
        or_unknown(&repo.branch),
        or_unknown(&repo.head),
        or_unknown(&repo.age)
    )];
    if repo.dirty > 0 {
        bits.push(format!("{} uncommitted", repo.dirty));
    }
    if !repo.ci.is_empty() {
        bits.push(format!("CI {}", repo.ci));
    }
    if repo.prs > 0 {
        bits.push(format!("{} open PR(s): {}", repo.prs, repo.pr_title));
    }
    bits.join(" · ")
}

fn repo_lines(state: &FleetState) -> Vec<String> {
    let mut lines = Vec::new();
    for repo in &state.repos {
        match &repo.error {
            Some(error) => lines.push(format!("{}: {error}", repo.repo)),
            None => lines.push(repo_line(repo)),
        }
    }
    if let Some(waivers) = &state.waivers {
        let mut tail = format!(
            "waivers: {} live, next review {}",
            waivers.count,
            or_unknown(&waivers.next)
        );
        if waivers.expired > 0 {
            tail.push_str(&format!(", {} EXPIRED", waivers.expired));
        }
        lines.push(tail);
    }
    lines
}

fn server_bits(server: &ServerProbe, now: DateTime<Utc>) -> Vec<String> {
    let mut bits = vec![format!(
        "{}: kernel {}",
        server.host,
        or_unknown(server.kernel.as_deref().unwrap_or(""))
    )];
    if server.reboot.as_deref() == Some("required") {
        bits.push("REBOOT REQUIRED".to_string());
    }
    if is_set(&server.secupdates) {
        bits.push(format!(
            "{} pending security update(s)",
            server.secupdates.as_deref().unwrap_or("?")
        ));
    } else {
        bits.push("no pending security updates".to_string());
    }
    bits.push(format!(
        "disk {}%",
        or_unknown(server.disk.as_deref().unwrap_or(""))
    ));
    bits.push(format!(
        "{} containers up",
        or_unknown(server.containers.as_deref().unwrap_or(""))
    ));
    if is_set(&server.unhealthy) {
        bits.push(format!(
            "{} UNHEALTHY",
            server.unhealthy.as_deref().unwrap_or("?")
        ));
    }
    if is_set(&server.restarting) {
        bits.push(format!(
            "{} restarting",
            server.restarting.as_deref().unwrap_or("?")
        ));
    }
    if server.backup_stale.as_deref() == Some("1") {
        bits.push("backup STALE".to_string());
    }
    if server.offsite_stale.as_deref() == Some("1") {
        bits.push("offsite copy STALE".to_string());
    }
    bits.push(scan_line(server.lastscan.as_deref().unwrap_or(""), now));
    bits
}

fn server_lines(state: &FleetState, now: DateTime<Utc>) -> Vec<String> {
    let mut lines = Vec::new();
    for server in &state.servers {
        match &server.error {
            Some(error) => lines.push(format!("{}: UNREACHABLE — {error}", server.host)),
            None => lines.push(server_bits(server, now).join(" · ")),
        }
    }
    if !state.uncovered.is_empty() {
        lines.push(format!(
            "not probed (no route configured): {}",
            state.uncovered.join(", ")
        ));
    }
    lines
}

/// `(repo lines, server lines)` at a given clock, so the scan rule is testable.
pub fn as_lines_at(state: &FleetState, now: DateTime<Utc>) -> (Vec<String>, Vec<String>) {
    (repo_lines(state), server_lines(state, now))
}

pub fn as_lines(state: &FleetState) -> (Vec<String>, Vec<String>) {
    as_lines_at(state, now_utc())
}
