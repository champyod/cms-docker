//! The output guard: a brief may only name ids that were in the input.

use std::collections::BTreeSet;
use std::sync::LazyLock;

use regex::Regex;

static CVE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"CVE-\d{4}-\d{4,}").expect("static CVE pattern"));
static GHSA_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"GHSA-[\w-]{10,}").expect("static GHSA pattern"));

const REFUSALS: [&str; 4] = ["as an ai", "i cannot", "i'm sorry", "cannot assist"];

/// Ok only when every id the text names is one the collector read.
pub fn check(text: &str, allowed: &BTreeSet<String>) -> Result<(), String> {
    if text.chars().count() < 200 {
        return Err("too short".to_string());
    }
    let lower = text.to_lowercase();
    if REFUSALS.iter().any(|phrase| lower.contains(phrase)) {
        return Err("refusal".to_string());
    }
    let upper = text.to_uppercase();
    let mut named: BTreeSet<String> = CVE_RE
        .find_iter(&upper)
        .map(|hit| hit.as_str().to_string())
        .collect();
    named.extend(GHSA_RE.find_iter(text).map(|hit| hit.as_str().to_string()));
    let invented: Vec<&String> = named.difference(allowed).collect();
    if invented.is_empty() {
        return Ok(());
    }
    let shown: Vec<String> = invented.iter().take(3).map(|id| (*id).clone()).collect();
    Err(format!("invented ids: [{}]", shown.join(", ")))
}
