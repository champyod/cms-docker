//! Turn the raw feed dump into three short, ranked lists.
//!
//! The ranking is deterministic and testable; the model downstream only writes
//! prose over these rows. A rule that silently dropped a critical item would be
//! invisible in a generated brief, so every section records why each row is there.

mod merge;

use std::collections::{BTreeMap, BTreeSet};
use std::sync::LazyLock;

use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::inventory::Inventory;
use crate::matchtext::{alternation, has_bounded_match};
use crate::model::{Advisory, Feeds};
use crate::text::take_chars;

pub const MAX_ACT_NOW: usize = 8;
pub const MAX_WATCH: usize = 6;
pub const MAX_INDUSTRY: usize = 5;
pub const MAX_NEWS: usize = 4;

/// Products we do not run but that most of the internet runs: worth a warning line.
const WIDELY_USED: &[&str] = &[
    "linux", "openssl", "openssh", "glibc", "curl", "bash", "sudo", "systemd", "chrome",
    "chromium", "firefox", "windows", "android", "kubernetes", "docker", "wordpress", "nginx",
    "apache", "postgres", "mysql", "redis", "jenkins", "gitlab", "vmware", "citrix", "ivanti",
    "fortinet", "palo alto", "cisco", "exchange", "sharepoint", "confluence", "jira", "teamcity",
    "go", "node", "java", "log4j", "spring", "tomcat", "php", "laravel", "rails", "django",
];

static WIDE_RE: LazyLock<Regex> = LazyLock::new(|| alternation(WIDELY_USED));

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct NewsLine {
    pub title: String,
    pub url: Option<String>,
    pub source: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct SectionCounts {
    pub act_now: usize,
    pub watch: usize,
    pub industry: usize,
    pub news: usize,
    pub rest_critical: usize,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Sections {
    pub act_now: Vec<Advisory>,
    pub watch: Vec<Advisory>,
    pub industry: Vec<Advisory>,
    pub news: Vec<NewsLine>,
    pub rest_critical: usize,
    pub seen_ids: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Stats {
    pub fetched: BTreeMap<String, usize>,
    pub merged: usize,
    pub ours: usize,
    pub fresh: usize,
    pub sections: SectionCounts,
}

pub(crate) fn widely(item: &Advisory) -> bool {
    let names = format!("{} {}", item.products.join(" "), item.title).to_lowercase();
    has_bounded_match(&names, &WIDE_RE)
}

/// Three lists, each truncated after the remainder has been counted.
fn classify(items: Vec<Advisory>) -> Sections {
    let mut act_now: Vec<Advisory> = Vec::new();
    let mut watch: Vec<Advisory> = Vec::new();
    let mut industry: Vec<Advisory> = Vec::new();
    for item in items {
        let ours = !item.ours.is_empty();
        if ours && item.is_critical() {
            act_now.push(item);
        } else if !ours && item.is_critical() && widely(&item) {
            watch.push(item);
        } else if !ours && item.is_critical() {
            industry.push(item);
        } else if ours && (item.severity == "high" || item.score.unwrap_or(0.0) >= 7.0) {
            watch.push(item);
        }
    }
    merge::sort_act_and_watch(&mut act_now);
    merge::sort_act_and_watch(&mut watch);
    merge::sort_industry(&mut industry);
    let rest_critical = industry.len().saturating_sub(MAX_INDUSTRY);
    act_now.truncate(MAX_ACT_NOW);
    watch.truncate(MAX_WATCH);
    industry.truncate(MAX_INDUSTRY);
    Sections {
        act_now,
        watch,
        industry,
        rest_critical,
        ..Sections::default()
    }
}

fn seen_ids(sections: &Sections) -> Vec<String> {
    let mut ids: BTreeSet<String> = BTreeSet::new();
    for item in sections
        .act_now
        .iter()
        .chain(&sections.watch)
        .chain(&sections.industry)
    {
        if !item.id.is_empty() {
            ids.insert(item.id.clone());
        }
        for cve in &item.cves {
            if !cve.is_empty() {
                ids.insert(cve.clone());
            }
        }
    }
    ids.into_iter().collect()
}

/// The payload fields the brief is allowed to quote, trimmed to their budget.
fn slim(sections: &mut Sections) {
    let all = sections
        .act_now
        .iter_mut()
        .chain(sections.watch.iter_mut())
        .chain(sections.industry.iter_mut());
    for item in all {
        item.summary = take_chars(&item.summary, 320);
        if item.detail.len() > 6 {
            let keep: Vec<String> = item.detail.keys().take(6).cloned().collect();
            item.detail.retain(|key, _| keep.contains(key));
        }
    }
}

fn news_lines(items: &[Advisory]) -> Vec<NewsLine> {
    items
        .iter()
        .filter(|item| !item.title.is_empty())
        .take(MAX_NEWS)
        .map(|item| NewsLine {
            title: item.title.clone(),
            url: if item.url.is_empty() {
                None
            } else {
                Some(item.url.clone())
            },
            source: if item.source.is_empty() {
                None
            } else {
                Some(item.source.clone())
            },
        })
        .collect()
}

fn fetched_counts(feeds: &Feeds) -> BTreeMap<String, usize> {
    let mut counts = BTreeMap::new();
    for kind in ["kev", "usn", "avg", "ghsa", "nvd", "news"] {
        counts.insert(kind.to_string(), feeds.by_kind(kind).len());
    }
    counts
}

pub fn build_digest(
    feeds: &Feeds,
    inv: &Inventory,
    seen: &BTreeSet<String>,
) -> (Sections, Stats) {
    let mut merged = merge::merge(feeds);
    let inv_keys: BTreeSet<String> = inv.products.keys().cloned().collect();
    merge::annotate(&mut merged, &inv_keys, seen);
    let merged_count = merged.len();
    let ours_count = merged.iter().filter(|item| !item.ours.is_empty()).count();
    let fresh_count = merged.iter().filter(|item| item.fresh).count();

    let mut sections = classify(merged);
    sections.seen_ids = seen_ids(&sections);
    sections.news = news_lines(&feeds.news);
    slim(&mut sections);

    let stats = Stats {
        fetched: fetched_counts(feeds),
        merged: merged_count,
        ours: ours_count,
        fresh: fresh_count,
        sections: SectionCounts {
            act_now: sections.act_now.len(),
            watch: sections.watch.len(),
            industry: sections.industry.len(),
            news: sections.news.len(),
            rest_critical: sections.rest_critical,
        },
    };
    (sections, stats)
}
