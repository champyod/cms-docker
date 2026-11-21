//! Ubuntu security notices, with the RSS fallback the JSON endpoint keeps needing.
//!
//! `notices.json` rate-limits hard (503s are routine); the RSS feed does not, but
//! carries no package list. Items from that path are matched on the title only and
//! are marked as such instead of pretending to know which release is affected.

use std::collections::BTreeSet;

use chrono::{DateTime, Utc};
use regex::Regex;
use serde::Deserialize;
use serde_json::json;
use std::sync::LazyLock;

use super::rss;
use super::Feed;
use crate::http;
use crate::inventory::{key_for, products_in_text};
use crate::model::Advisory;
use crate::text::take_chars;
use crate::timeutil::parse_dt;

const JSON_URL: &str = "https://ubuntu.com/security/notices.json?limit=200";
const RSS_URL: &str = "https://ubuntu.com/security/notices/rss.xml";
const TTL_SECS: u64 = 3 * 3600;

/// Host packages we actually run, so a USN is judged on what it can touch.
const HOST_PACKAGES: &[&str] = &[
    "linux", "linux-signed", "linux-aws", "openssl", "libssl3", "libc6", "glibc", "nginx",
    "postgresql", "postgresql-15", "redis", "python3.10", "python3", "docker.io", "containerd",
    "systemd", "openssh", "sudo", "curl", "gnupg", "bash", "perl", "vim", "tar", "xz-utils",
    "dpkg", "apt",
];

static USN_ID: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(USN-[\d-]+)").expect("static USN id prefix"));

#[derive(Debug, Default, Deserialize)]
struct UsnFeed {
    #[serde(default)]
    notices: Vec<UsnNotice>,
}

#[derive(Debug, Default, Deserialize)]
struct UsnNotice {
    #[serde(default)]
    id: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    summary: String,
    #[serde(default)]
    published: String,
    #[serde(default)]
    cves: Vec<String>,
    #[serde(default)]
    release_packages: std::collections::BTreeMap<String, Vec<UsnPackage>>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct UsnPackage {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    version: Option<String>,
}

fn fixed_versions(release: &[UsnPackage]) -> String {
    let versions: BTreeSet<&str> = release.iter().filter_map(|p| p.version.as_deref()).collect();
    if versions.is_empty() {
        return String::new();
    }
    let listed: Vec<&str> = versions.iter().take(3).copied().collect();
    format!("jammy {}", listed.join(", "))
}

fn notice_products(pkgs: &BTreeSet<String>, title: &str) -> Vec<String> {
    let from_packages: BTreeSet<&str> = pkgs
        .iter()
        .filter_map(|p| key_for(p.split(':').next().unwrap_or(p)))
        .collect();
    if from_packages.is_empty() {
        products_in_text(title)
    } else {
        from_packages.into_iter().map(str::to_string).collect()
    }
}

pub fn parse_json(body: &str, since: DateTime<Utc>) -> Result<Vec<Advisory>, String> {
    let feed: UsnFeed = serde_json::from_str(body).map_err(|e| format!("not JSON: {e}"))?;
    let mut items = Vec::new();
    for notice in feed.notices {
        let Some(published) = parse_dt(&notice.published) else {
            continue;
        };
        if published < since {
            continue;
        }
        let release = notice.release_packages.get("jammy").cloned().unwrap_or_default();
        let pkgs: BTreeSet<String> = release.iter().filter_map(|p| p.name.clone()).collect();
        if !HOST_PACKAGES.iter().any(|host| pkgs.contains(*host)) {
            continue;
        }
        let mut item = Advisory::new(
            notice.id.clone(),
            "usn",
            "Ubuntu USN",
            format!("https://ubuntu.com/security/notices/{}", notice.id),
            notice.published.clone(),
        );
        item.title = notice.title;
        item.summary = take_chars(&notice.summary, 400);
        item.cves = notice.cves;
        item.products = notice_products(&pkgs, &item.title);
        item.detail.insert(
            "packages".into(),
            json!(pkgs.iter().take(12).cloned().collect::<Vec<_>>()),
        );
        item.detail.insert("fixed".into(), json!(fixed_versions(&release)));
        items.push(item);
    }
    Ok(items)
}

pub fn parse_rss(body: &str, since: DateTime<Utc>) -> Vec<Advisory> {
    let mut items = Vec::new();
    for raw in rss::items(body, 10_000) {
        let published = parse_dt(&raw.date);
        if published.is_some_and(|at| at < since) {
            continue;
        }
        let products = products_in_text(&raw.title);
        if products.is_empty() {
            continue;
        }
        let id = USN_ID
            .captures(&raw.title)
            .map(|caps| caps[1].to_string())
            .unwrap_or_else(|| take_chars(&raw.title, 40));
        let mut item = Advisory::new(id, "usn", "Ubuntu USN (RSS)", raw.link, raw.date);
        item.title = raw.title;
        item.summary = "package list not available on this feed path".to_string();
        item.products = products;
        item.detail
            .insert("note".into(), json!("RSS fallback: affected packages unverified"));
        items.push(item);
    }
    items
}

fn json_path(since: DateTime<Utc>) -> Result<Feed, String> {
    let fetch = http::get(JSON_URL, TTL_SECS)?;
    let items = parse_json(&fetch.body, since)?;
    Ok(Feed {
        items,
        warning: fetch.warning,
    })
}

fn rss_path(since: DateTime<Utc>, json_error: &str) -> Feed {
    match http::get(RSS_URL, TTL_SECS) {
        Ok(fetch) => {
            let note = match &fetch.warning {
                None => " (served RSS fallback)".to_string(),
                Some(warning) => format!(" / Ubuntu USN RSS: {warning}"),
            };
            Feed {
                items: parse_rss(&fetch.body, since),
                warning: Some(format!("Ubuntu USN: {json_error}{note}")),
            }
        }
        Err(error) => Feed {
            items: Vec::new(),
            warning: Some(format!("Ubuntu USN: {json_error} / Ubuntu USN RSS: {error}")),
        },
    }
}

/// The JSON path first, the RSS path when it fails; the warning says which ran.
pub fn collect(since: DateTime<Utc>) -> Result<Feed, String> {
    match json_path(since) {
        Ok(feed) => Ok(feed),
        Err(json_error) => Ok(rss_path(since, &json_error)),
    }
}
