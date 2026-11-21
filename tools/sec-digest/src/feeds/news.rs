//! News headlines: context only, never a source of CVE facts.

use chrono::{DateTime, Utc};

use super::rss;
use super::Feed;
use crate::http;
use crate::model::Advisory;
use crate::text::{stable_hash, take_chars};
use crate::timeutil::parse_dt;

const FEEDS: &[(&str, &str)] = &[
    ("BleepingComputer", "https://www.bleepingcomputer.com/feed/"),
    ("The Hacker News", "https://feeds.feedburner.com/TheHackersNews"),
    ("The Register", "https://www.theregister.com/security/headlines.atom"),
];
const TTL_SECS: u64 = 3 * 3600;
const MAX_ITEMS: usize = 40;
const WORDS: &[&str] = &[
    "exploit",
    "critical",
    "zero-day",
    "breach",
    "ransomware",
    "backdoor",
    "supply chain",
    "cve-",
    "vulnerab",
    "patch tuesday",
    "actively",
];

fn is_relevant(title: &str) -> bool {
    let lowered = title.to_lowercase();
    WORDS.iter().any(|word| lowered.contains(word))
}

/// One feed's items: keyword-filtered, dated, and id'd from the title.
pub fn parse(body: &str, source: &str, since: DateTime<Utc>) -> Vec<Advisory> {
    let mut items = Vec::new();
    for raw in rss::items(body, MAX_ITEMS) {
        if !is_relevant(&raw.title) {
            continue;
        }
        if parse_dt(&raw.date).is_some_and(|at| at < since) {
            continue;
        }
        let id = format!("news:{}", stable_hash(&raw.title) % 10_000_000_000);
        let mut item = Advisory::new(id, "news", source, raw.link, raw.date);
        item.title = take_chars(&raw.title, 300);
        items.push(item);
    }
    items
}

/// Never fails as a whole: one dead newsroom does not silence the other two.
pub fn collect(since: DateTime<Utc>) -> Feed {
    let mut items = Vec::new();
    let mut errors = Vec::new();
    for (name, url) in FEEDS {
        match http::get(url, TTL_SECS) {
            Ok(fetch) => items.extend(parse(&fetch.body, name, since)),
            Err(error) => errors.push(format!("{name}: {error}")),
        }
    }
    items.truncate(MAX_ITEMS);
    Feed {
        items,
        warning: if errors.is_empty() {
            None
        } else {
            Some(errors.join("; "))
        },
    }
}
