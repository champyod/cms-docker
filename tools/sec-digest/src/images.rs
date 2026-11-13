//! The nightly image scan as the digest reads it: one small fact, fetched by artifact.
//!
//! WHY an artifact and not an API scrape: the workflow's summary is HTML and its tracking issue
//! cannot exist on a repository with Issues disabled, so the only durable, machine-readable half of
//! that run is a file it uploads. Pulling it here keeps the "no secret in CI" rule intact.

use std::path::{Path, PathBuf};
use std::process::Command;

use chrono::{DateTime, Utc};
use serde::Deserialize;

/// The workflow that produces the artifact; both the run lookup and the message name it.
pub const WORKFLOW: &str = "image-scan.yml";
/// The artifact name the workflow uploads.
pub const ARTIFACT: &str = "image-scan-verdict";

#[derive(Debug, Clone, Deserialize)]
pub struct Verdict {
    pub at: String,
    pub state: String,
    pub refs: i64,
    pub fixable: Option<i64>,
    pub drift: i64,
    pub unknown: i64,
    pub bumped: bool,
    pub pr: Option<i64>,
}

impl Verdict {
    /// Anything a human would act on: fixable findings, or a pin the scan found stale.
    pub fn actionable(&self) -> bool {
        self.fixable.unwrap_or(0) > 0 || self.drift > 0
    }

    /// A run that reached no verdict must never read as a clean one.
    pub fn judged(&self) -> bool {
        self.state != "incomplete"
    }
}

/// Parses the artifact the workflow writes; a missing field is an error, not a zero.
pub fn parse(json: &str) -> Result<Verdict, String> {
    serde_json::from_str::<Verdict>(json).map_err(|error| format!("verdict json: {error}"))
}

/// One line for the digest, in the same three-tier language as every other surface.
pub fn line(verdict: &Verdict, now: DateTime<Utc>) -> String {
    let when = stamp(&verdict.at);
    let age_note = match age_hours(&verdict.at, now) {
        Some(hours) if hours > 36.0 => format!(" · STALE ({hours:.0}h)"),
        _ => String::new(),
    };
    if !verdict.judged() {
        return format!("images: NOT JUDGED — the last run ({when}) produced no table{age_note}");
    }
    let fixable = match verdict.fixable {
        Some(n) => format!("{n} fixable"),
        None => "fixable unknown".to_string(),
    };
    let pr = match verdict.pr {
        Some(number) if verdict.bumped => format!(" · PR #{number} open"),
        _ => String::new(),
    };
    let verdict_word = if verdict.actionable() { "act now" } else { "nothing to do" };
    format!(
        "images: {verdict_word} — {fixable} · {} drifted · {} unreadable · {} refs · run {when}{pr}{age_note}",
        verdict.drift, verdict.unknown, verdict.refs
    )
}

/// Downloads the newest artifact and parses it; every failure is a phrase, never an empty line.
pub fn fetch(workdir: &Path) -> Result<Verdict, String> {
    let listed = run(&["run", "list", "--workflow", WORKFLOW, "--limit", "1", "--json", "databaseId"])?;
    let runs: serde_json::Value =
        serde_json::from_str(&listed).map_err(|error| format!("gh run list: {error}"))?;
    let id = runs
        .as_array()
        .and_then(|items| items.first())
        .and_then(|first| first.get("databaseId"))
        .and_then(serde_json::Value::as_i64)
        .ok_or_else(|| "no image-scan run found".to_string())?;

    let stop = workdir.join("image-scan-artifact");
    let _ = std::fs::remove_dir_all(&stop);
    std::fs::create_dir_all(&stop).map_err(|error| format!("artifact dir: {error}"))?;
    run(&[
        "run",
        "download",
        &id.to_string(),
        "--name",
        ARTIFACT,
        "--dir",
        &stop.to_string_lossy(),
    ])?;

    let file: PathBuf = stop.join("verdict.json");
    let text = std::fs::read_to_string(&file).map_err(|error| format!("verdict.json: {error}"))?;
    parse(&text)
}

/// `gh` with a failure turned into the message the digest prints.
fn run(args: &[&str]) -> Result<String, String> {
    let output = Command::new("gh")
        .args(args)
        .output()
        .map_err(|error| format!("gh not runnable: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("gh {} failed: {}", args.first().unwrap_or(&""), stderr.trim()));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// `2026-11-13T03:17:00Z` → `2026-11-13 03:17`; an unparseable stamp is shown as it arrived.
fn stamp(at: &str) -> String {
    match DateTime::parse_from_rfc3339(at) {
        Ok(parsed) => parsed.with_timezone(&Utc).format("%Y-%m-%d %H:%M").to_string(),
        Err(_) => at.to_string(),
    }
}

/// Hours since the run, or `None` when the stamp cannot be read — never a silent zero.
fn age_hours(at: &str, now: DateTime<Utc>) -> Option<f64> {
    let parsed = DateTime::parse_from_rfc3339(at).ok()?;
    let delta = now.signed_duration_since(parsed.with_timezone(&Utc));
    Some(delta.num_minutes() as f64 / 60.0)
}
