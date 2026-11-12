//! Cross-feed merging and the two ordering rules.

use std::collections::{BTreeSet, HashMap};

use crate::model::{Advisory, Feeds};

use super::widely;

/// Fold the second report of a CVE into the first row, keeping the stronger facts.
fn absorb(current: &mut Advisory, incoming: &Advisory) {
    let mut products: BTreeSet<String> = current.products.iter().cloned().collect();
    products.extend(incoming.products.iter().cloned());
    current.products = products.into_iter().collect();
    current.exploited |= incoming.exploited;
    current.score = Some(current.score.unwrap_or(0.0).max(incoming.score.unwrap_or(0.0)));
    if incoming.kind == "kev" {
        current.kind = "kev".to_string();
        current.source = "CISA KEV".to_string();
        current.url.clone_from(&incoming.url);
    }
    if incoming.summary.chars().count() > current.summary.chars().count() {
        current.summary.clone_from(&incoming.summary);
    }
}

/// Collapse duplicates that several feeds report (same CVE, different source).
///
/// Feed order decides the winner: KEV first, so an exploited entry keeps that fact.
pub(crate) fn merge(feeds: &Feeds) -> Vec<Advisory> {
    let mut merged: Vec<Advisory> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    for kind in ["kev", "usn", "avg", "ghsa", "nvd"] {
        for item in feeds.by_kind(kind) {
            let keys = if item.cves.is_empty() {
                vec![item.id.clone()]
            } else {
                item.cves.clone()
            };
            for cve in keys {
                if cve.is_empty() {
                    continue;
                }
                match index.get(&cve) {
                    None => {
                        let mut first = item.clone();
                        first.cves = vec![cve.clone()];
                        index.insert(cve, merged.len());
                        merged.push(first);
                    }
                    Some(&at) => absorb(&mut merged[at], item),
                }
            }
        }
    }
    merged
}

/// Which inventory keys an advisory touches, plus the version-exact marker.
pub(crate) fn annotate(items: &mut [Advisory], inv_keys: &BTreeSet<String>, seen: &BTreeSet<String>) {
    for item in items.iter_mut() {
        let mut hits: BTreeSet<String> = item
            .products
            .iter()
            .filter(|product| inv_keys.contains(*product))
            .cloned()
            .collect();
        if !item.detail_list("matches_ours").is_empty() {
            hits.insert("version-match".to_string());
        }
        item.ours = hits.into_iter().collect();
        item.fresh = !seen.contains(&item.id) && !item.cves.iter().all(|cve| seen.contains(cve));
        item.severity = item.severity.to_lowercase();
    }
}

pub(crate) fn sort_act_and_watch(items: &mut [Advisory]) {
    items.sort_by(|a, b| {
        (!a.fresh)
            .cmp(&(!b.fresh))
            .then(a.exploited.cmp(&b.exploited))
            .then(a.score.unwrap_or(0.0).total_cmp(&b.score.unwrap_or(0.0)))
            .then(a.published.cmp(&b.published))
    });
}

/// "All critical" would be a hundred unrelated products a day; what earns a line
/// is exploited-in-the-wild first, then software most of the internet runs, then
/// the highest score — the remainder is counted, not listed.
pub(crate) fn sort_industry(items: &mut [Advisory]) {
    items.sort_by(|a, b| {
        b.exploited
            .cmp(&a.exploited)
            .then(widely(b).cmp(&widely(a)))
            .then(b.score.unwrap_or(0.0).total_cmp(&a.score.unwrap_or(0.0)))
    });
}
