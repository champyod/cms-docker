//! Minimal RSS/Atom item extraction, shared by the USN fallback and the news feeds.
//!
//! The Python tool parses these with three regexes and no XML library; the same
//! patterns are kept here so a feed that parsed there parses here.

use regex::Regex;
use std::sync::LazyLock;

use crate::text::strip_tags;

static ITEM: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?s)<(?:item|entry)\b.*?</(?:entry|item)>").expect("static item"));
static TITLE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?s)<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</title>").expect("static title")
});
static LINK: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?s)<link[^>]*href="([^"]+)"|<link>(.*?)</link>"#).expect("static link"));
static DATE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?s)<(?:pubDate|published|updated)[^>]*>(.*?)</").expect("static date")
});

#[derive(Debug, Clone, Default)]
pub struct RawItem {
    pub title: String,
    pub link: String,
    pub date: String,
}

fn link_of(chunk: &str) -> String {
    LINK.captures(chunk)
        .map(|caps| {
            caps.get(1)
                .or_else(|| caps.get(2))
                .map(|m| m.as_str().trim().to_string())
                .unwrap_or_default()
        })
        .unwrap_or_default()
}

/// Every item with a readable title; entries without one are skipped.
pub fn items(body: &str, limit: usize) -> Vec<RawItem> {
    let mut out = Vec::new();
    for chunk in ITEM.find_iter(body).take(limit) {
        let Some(caps) = TITLE.captures(chunk.as_str()) else {
            continue;
        };
        let title = strip_tags(&caps[1]);
        if title.is_empty() {
            continue;
        }
        let date = DATE
            .captures(chunk.as_str())
            .map(|c| c[1].trim().to_string())
            .unwrap_or_default();
        out.push(RawItem {
            title,
            link: link_of(chunk.as_str()),
            date,
        });
    }
    out
}
