//! HTTP with a disk cache, retries, and an error that is always a sentence.
//!
//! A vendor endpoint that rate-limits (ubuntu.com 503s constantly) must not turn
//! into an empty advisory list: the caller gets either a body with a warning
//! ("served stale cache"), or an error string it can print.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::{Duration, SystemTime};

use ureq::Agent;

const UA: &str = "cms-sec-digest/1.0 (+ops; contact: operator)";
const TRIES: u32 = 3;
const TIMEOUT_SECS: u64 = 30;
const MAX_BODY: u64 = 64 * 1024 * 1024;

static AGENT: LazyLock<Agent> = LazyLock::new(|| {
    Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(TIMEOUT_SECS)))
        .user_agent(UA)
        .build()
        .new_agent()
});

/// A body plus the reason it might be out of date.
pub struct Fetch {
    pub body: String,
    pub warning: Option<String>,
}

/// State root: same variable and default as the Python tool, so a deployment can
/// share one directory without either tool reading the other's files.
pub fn state_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("SEC_DIGEST_STATE") {
        return PathBuf::from(dir);
    }
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    home.join(".hermes/state/sec-daily")
}

/// Stable, non-cryptographic cache key; `rs-` keeps it clear of the Python hashes.
fn cache_path(url: &str) -> PathBuf {
    state_dir().join("cache").join(format!("rs-{:016x}.body", fnv1a(url)))
}

fn fnv1a(s: &str) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in s.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

fn cache_is_fresh(path: &Path, ttl_secs: u64) -> bool {
    let Ok(meta) = fs::metadata(path) else {
        return false;
    };
    let Ok(modified) = meta.modified() else {
        return false;
    };
    SystemTime::now()
        .duration_since(modified)
        .map(|age| age.as_secs() < ttl_secs)
        .unwrap_or(false)
}

fn cache_age_minutes(path: &Path) -> u64 {
    let Ok(meta) = fs::metadata(path) else {
        return 0;
    };
    let Ok(modified) = meta.modified() else {
        return 0;
    };
    SystemTime::now()
        .duration_since(modified)
        .map(|age| age.as_secs() / 60)
        .unwrap_or(0)
}

fn describe(err: ureq::Error) -> String {
    match err {
        ureq::Error::StatusCode(code) => format!("HTTP {code}"),
        other => other.to_string(),
    }
}

fn attempt(url: &str) -> Result<String, String> {
    let mut response = AGENT.get(url).header("Accept", "*/*").call().map_err(describe)?;
    response
        .body_mut()
        .with_config()
        .limit(MAX_BODY)
        .read_to_string()
        .map_err(|e| format!("read: {e}"))
}

/// Fetch a URL, serving a fresh cache without touching the network.
pub fn get(url: &str, ttl_secs: u64) -> Result<Fetch, String> {
    let path = cache_path(url);
    if cache_is_fresh(&path, ttl_secs) {
        if let Ok(body) = fs::read_to_string(&path) {
            return Ok(Fetch { body, warning: None });
        }
    }
    let mut last = String::from("no attempt");
    for try_no in 0..TRIES {
        match attempt(url) {
            Ok(body) if !body.trim().is_empty() => {
                if let Some(dir) = path.parent() {
                    let _ = fs::create_dir_all(dir);
                }
                let _ = fs::write(&path, &body);
                return Ok(Fetch { body, warning: None });
            }
            Ok(_) => last = "empty body".to_string(),
            Err(err) => {
                if err == "HTTP 404" || err == "HTTP 410" {
                    last = err;
                    break;
                }
                last = err;
            }
        }
        if try_no + 1 < TRIES {
            std::thread::sleep(Duration::from_secs(2 * (u64::from(try_no) + 1)));
        }
    }
    if let Ok(body) = fs::read_to_string(&path) {
        let age = cache_age_minutes(&path);
        return Ok(Fetch {
            body,
            warning: Some(format!("{last} (served stale cache, {age}m old)")),
        });
    }
    Err(last)
}

/// Fetch and parse JSON, keeping the distinction between "broken" and "empty".
pub fn get_json(url: &str, ttl_secs: u64) -> Result<(serde_json::Value, Option<String>), String> {
    let fetch = get(url, ttl_secs)?;
    match serde_json::from_str::<serde_json::Value>(&fetch.body) {
        Ok(value) => Ok((value, fetch.warning)),
        Err(err) => Err(format!("not JSON: {err}")),
    }
}
