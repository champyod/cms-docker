//! Small text helpers shared by the feed parsers and the renderer.
//!
//! Lengths are counted in characters, matching the Python tool, so a trimmed
//! title is trimmed at the same place and never split mid-character.

use regex::Regex;
use std::sync::LazyLock;

static TAGS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<[^>]+>").expect("static tag strip"));

pub fn take_chars(text: &str, limit: usize) -> String {
    text.chars().take(limit).collect()
}

pub fn char_len(text: &str) -> usize {
    text.chars().count()
}

/// Drop markup a feed embedded in a title.
pub fn strip_tags(text: &str) -> String {
    TAGS.replace_all(text, "").trim().to_string()
}

/// Stable id helper for feed entries that carry no id of their own.
/// Python used `hash()`, which is salted per process and therefore not stable
/// across runs; the digest's dedupe needs an id that is the same tomorrow.
pub fn stable_hash(text: &str) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in text.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}
