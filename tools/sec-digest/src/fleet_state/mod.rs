//! What the repos and the servers look like right now — the "mine" half of the brief.
//!
//! A host that cannot be reached is reported as unreachable, and a scan that
//! stopped is named as stale, never shown as healthy silence.

pub mod collect;
pub mod exec;
pub mod lines;
pub mod probe;
pub mod repos;
pub mod scan;
pub mod servers;
pub mod waivers;

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::text::take_chars;

pub use collect::{collect, Config};
pub use exec::{Runner, SystemRunner};
pub use lines::{as_lines, as_lines_at};
pub use scan::{scan_line, ScanResult, SCAN_STALE_HOURS};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RepoState {
    pub repo: String,
    #[serde(default)]
    pub branch: String,
    #[serde(default)]
    pub head: String,
    #[serde(default)]
    pub age: String,
    #[serde(default)]
    pub subject: String,
    #[serde(default)]
    pub dirty: usize,
    #[serde(default)]
    pub ci: String,
    #[serde(default)]
    pub prs: usize,
    #[serde(default)]
    pub pr_title: String,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ServerProbe {
    pub host: String,
    #[serde(default)]
    pub kernel: Option<String>,
    #[serde(default)]
    pub reboot: Option<String>,
    #[serde(default)]
    pub secupdates: Option<String>,
    #[serde(default)]
    pub disk: Option<String>,
    #[serde(default)]
    pub containers: Option<String>,
    #[serde(default)]
    pub unhealthy: Option<String>,
    #[serde(default)]
    pub restarting: Option<String>,
    #[serde(default)]
    pub uptime: Option<String>,
    #[serde(default)]
    pub lastscan: Option<String>,
    #[serde(default, rename = "cms_backup_stale")]
    pub backup_stale: Option<String>,
    #[serde(default, rename = "cms_offsite_stale")]
    pub offsite_stale: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub extra: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Waivers {
    #[serde(default)]
    pub count: usize,
    #[serde(default)]
    pub next: String,
    #[serde(default)]
    pub expired: usize,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FleetState {
    #[serde(default)]
    pub repos: Vec<RepoState>,
    #[serde(default)]
    pub servers: Vec<ServerProbe>,
    #[serde(default)]
    pub waivers: Option<Waivers>,
    #[serde(default)]
    pub errors: Vec<String>,
    #[serde(default)]
    pub uncovered: Vec<String>,
}

fn set_field(probe: &mut ServerProbe, key: &str, value: &str) {
    let slot = match key {
        "kernel" => &mut probe.kernel,
        "reboot" => &mut probe.reboot,
        "secupdates" => &mut probe.secupdates,
        "disk" => &mut probe.disk,
        "containers" => &mut probe.containers,
        "unhealthy" => &mut probe.unhealthy,
        "restarting" => &mut probe.restarting,
        "uptime" => &mut probe.uptime,
        "lastscan" => &mut probe.lastscan,
        "cms_backup_stale" => &mut probe.backup_stale,
        "cms_offsite_stale" => &mut probe.offsite_stale,
        _ => {
            probe.extra.insert(key.to_string(), value.to_string());
            return;
        }
    };
    *slot = Some(value.to_string());
}

/// Read the one batched ssh probe. Errors survive as data, not as a panic.
pub fn parse_probe(host: &str, text: &str) -> ServerProbe {
    let mut probe = ServerProbe {
        host: host.to_string(),
        ..ServerProbe::default()
    };
    for line in text.lines() {
        if line.starts_with("__error__") {
            continue;
        }
        if let Some((key, value)) = line.split_once('=') {
            set_field(&mut probe, key.trim(), value.trim());
        } else if line.starts_with("cms_") {
            if let Some((key, value)) = line.split_once(' ') {
                set_field(&mut probe, key.trim(), value.trim());
            }
        }
    }
    if let Some((_, rest)) = text.split_once("__error__") {
        probe.error = Some(take_chars(rest.trim(), 120));
    }
    probe
}
