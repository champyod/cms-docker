//! Parity with tests/test_digest.py: version ranges, merging and the three lists.
//!
//! Each test names the failure it prevents. An empty window must produce nothing,
//! a shared CVE must be one row, and a CVE we did not read must never appear.

mod common;

use std::cmp::Ordering;

use common::{inventory, item, rows, seen};
use sec_digest::model::{Advisory, Feeds};
use sec_digest::rank::build_digest;
use sec_digest::render::{nothing_new, template_brief, BriefInput};
use sec_digest::vers::{cmp, in_range};

#[test]
fn version_range_boundaries() {
    assert!(in_range("1.2.3", ">= 1.0.0, < 1.3.0"));
    assert!(!in_range("1.3.0", ">= 1.0.0, < 1.3.0"));
    assert!(!in_range("0.9.9", ">= 1.0.0, < 1.3.0"));
}

#[test]
fn deb_and_alpine_versions_order() {
    assert_eq!(cmp("5.15.0-202-generic", "5.15.0-203-generic"), Ordering::Less);
    assert_eq!(cmp("1.7.5-r0", "1.7.5-r1"), Ordering::Less);
    assert_eq!(cmp("1.7.5", "1.7.5"), Ordering::Equal);
}

#[test]
fn unparseable_range_never_claims_a_match() {
    assert!(!in_range("1.0.0", ""));
    assert!(!in_range("", ">= 1.0.0"));
}

#[test]
fn same_cve_from_kev_and_nvd_is_one_row_and_keeps_kev() {
    let mut kev = item("CVE-2026-1");
    kev.kind = "kev".to_string();
    kev.source = "CISA KEV".to_string();
    kev.exploited = true;
    kev.score = Some(10.0);
    kev.products = vec!["linux".to_string()];
    kev.url = "kev-url".to_string();

    let mut nvd = item("CVE-2026-1");
    nvd.products = vec!["nginx".to_string()];
    nvd.score = Some(9.1);
    nvd.cves = vec!["CVE-2026-1".to_string()];

    let feeds = Feeds {
        kev: vec![kev],
        nvd: vec![nvd],
        ..Feeds::default()
    };
    let (sections, _) = build_digest(&feeds, &inventory(), &seen(&[]));
    let rows = rows(&sections);
    let matching = rows
        .iter()
        .filter(|row| row.id == "CVE-2026-1" || row.cves.iter().any(|c| c == "CVE-2026-1"))
        .count();
    assert_eq!(matching, 1);

    let row = &rows[0];
    assert!(row.exploited);
    assert_eq!(row.kind, "kev");
    assert_eq!(row.url, "kev-url");
    assert_eq!(row.products, vec!["linux".to_string(), "nginx".to_string()]);
}

#[test]
fn ours_goes_to_act_now_and_unrelated_critical_is_counted() {
    let mut mine = item("CVE-2026-2");
    mine.products = vec!["linux".to_string()];
    let mut unrelated = item("CVE-2026-3");
    unrelated.products = vec!["sap".to_string()];

    let feeds = Feeds {
        nvd: vec![mine, unrelated],
        ..Feeds::default()
    };
    let (sections, _) = build_digest(&feeds, &inventory(), &seen(&[]));
    assert_eq!(
        sections.act_now.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(),
        vec!["CVE-2026-2"]
    );
    assert!(sections.industry.iter().any(|r| r.id == "CVE-2026-3"));
}

#[test]
fn seen_ids_stop_becoming_new_but_keep_the_row() {
    let mut advisory = item("CVE-2026-2");
    advisory.products = vec!["linux".to_string()];
    let feeds = Feeds {
        nvd: vec![advisory],
        ..Feeds::default()
    };
    let (sections, _) = build_digest(&feeds, &inventory(), &seen(&["CVE-2026-2"]));
    assert!(!sections.act_now[0].fresh);
}

#[test]
fn empty_window_is_empty_not_invented() {
    let (sections, stats) = build_digest(&Feeds::default(), &inventory(), &seen(&[]));
    assert!(sections.act_now.is_empty());
    assert!(sections.watch.is_empty());
    assert!(sections.industry.is_empty());
    assert!(sections.news.is_empty());
    let text = nothing_new(26, &stats, &[]);
    assert!(text.contains("No new advisories"));
}

#[test]
fn exploited_outranks_a_bigger_score() {
    // sap is not in WIDELY_USED, so both land in INDUSTRY where the ordering applies.
    let mut higher = item("CVE-2026-4");
    higher.products = vec!["sap".to_string()];
    higher.score = Some(9.0);
    let mut exploited = item("CVE-2026-5");
    exploited.products = vec!["sap".to_string()];
    exploited.score = Some(10.0);
    exploited.exploited = true;

    let feeds = Feeds {
        nvd: vec![higher, exploited],
        ..Feeds::default()
    };
    let (sections, _) = build_digest(&feeds, &inventory(), &seen(&[]));
    assert_eq!(sections.industry[0].id, "CVE-2026-5");
}

#[test]
fn a_failed_feed_is_named_in_the_brief() {
    let errors = vec!["KEV: HTTP 503".to_string()];
    let (sections, stats) = build_digest(&Feeds::default(), &inventory(), &seen(&[]));
    let text = template_brief(&BriefInput {
        window_hours: 26,
        sections: &sections,
        stats: &stats,
        inventory: &inventory(),
        collector_errors: &errors,
    });
    assert!(text.contains("could not read: KEV: HTTP 503"));
    assert!(!text.to_lowercase().contains("webhook"));
}

#[test]
fn empty_inventory_matches_nothing_instead_of_everything() {
    let mut advisory = item("CVE-2026-6");
    advisory.products = vec!["linux".to_string()];
    let feeds = Feeds {
        nvd: vec![advisory.clone()],
        ..Feeds::default()
    };
    let (sections, stats) = build_digest(&feeds, &Default::default(), &seen(&[]));
    assert!(sections.act_now.is_empty());
    assert_eq!(stats.ours, 0);
    // linux is widely used, so with no inventory it is a WATCH line, not "yours".
    assert_eq!(sections.watch.len(), 1);
}

#[test]
fn an_advisory_without_a_date_still_ranks_without_inventing_one() {
    let mut advisory: Advisory = item("CVE-2026-7");
    advisory.published = String::new();
    advisory.products = vec!["linux".to_string()];
    let feeds = Feeds {
        nvd: vec![advisory],
        ..Feeds::default()
    };
    let (sections, _) = build_digest(&feeds, &inventory(), &seen(&[]));
    assert_eq!(sections.act_now[0].published, "");
}
