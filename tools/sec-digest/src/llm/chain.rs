//! chain.json: slots in order, each a command with a timeout and an optional workdir.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Deserialize;

fn default_timeout() -> u64 {
    240
}

#[derive(Debug, Clone, Deserialize)]
pub struct Slot {
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub cmd: Vec<String>,
    #[serde(default = "default_timeout")]
    pub timeout: u64,
    #[serde(default)]
    pub workdir: Option<PathBuf>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Chain {
    #[serde(default)]
    pub slots: Vec<Slot>,
}

impl Slot {
    pub fn label(&self) -> &str {
        if self.label.is_empty() {
            "unknown"
        } else {
            &self.label
        }
    }

    /// The Python replaces `autoclaw` (a GUI app here) when AUTOCLAW_CMD names a CLI.
    pub fn argv(&self, prompt: &str) -> Vec<String> {
        let mut cmd = self.cmd.clone();
        if let Some(override_cmd) = env::var_os("AUTOCLAW_CMD") {
            if cmd.first().map(String::as_str) == Some("autoclaw") {
                let mut parts: Vec<String> = override_cmd
                    .to_string_lossy()
                    .split_whitespace()
                    .map(str::to_string)
                    .collect();
                if !parts.is_empty() {
                    parts.extend(cmd.into_iter().skip(1));
                    cmd = parts;
                }
            }
        }
        cmd.iter().map(|arg| arg.replace("{prompt}", prompt)).collect()
    }
}

/// SEC_DIGEST_CHAIN, else the chain the Python production job reads.
pub fn path() -> PathBuf {
    if let Some(explicit) = env::var_os("SEC_DIGEST_CHAIN") {
        return PathBuf::from(explicit);
    }
    let home = env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    home.join(".hermes/scripts/sec-daily/chain.json")
}

pub fn load(path: &Path) -> Result<Chain, String> {
    let text = fs::read_to_string(path)
        .map_err(|error| format!("{}: {error}", path.display()))?;
    serde_json::from_str(&text).map_err(|error| format!("{}: not JSON: {error}", path.display()))
}
