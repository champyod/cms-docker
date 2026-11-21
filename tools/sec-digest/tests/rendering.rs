//! Parity with the rendering tests: sections, plain markdown, chat fit, byte stability.

mod common;

use std::fs;

use common::{cves_in, inventory, item, rows, seen};
use sec_digest::model::Feeds;
use sec_digest::rank::build_digest;
use sec_digest::record::RunRecord;
use sec_digest::render::{fit_for_chat, nothing_new, template_brief, BriefInput};

const FIXTURES: &str = "tests/fixtures";

fn payload() -> RunRecord {
    let text = fs::read_to_string(format!("{FIXTURES}/payload.json")).expect("payload fixture");
    serde_json::from_str(&text).expect("payload fixture parses as a run record")
}

#[test]
fn template_brief_has_every_section() {
    let record = payload();
    let text = template_brief(&record.brief_input());
    for heading in [
        "## ACT NOW",
        "## WATCH",
        "## INDUSTRY",
        "## NEWS",
        "## TODAY FOR YOU",
    ] {
        assert!(text.contains(heading), "missing {heading} in\n{text}");
    }
    assert!(text.contains("CVE-2026-7001"));
    assert!(text.contains("+ 3 further critical advisories"));
    assert!(text.contains("window 26h · 7 advisories read, 3 touch your stack"));
}

#[test]
fn the_brief_matches_the_python_renderer_byte_for_byte() {
    let recorded = fs::read_to_string(format!("{FIXTURES}/golden_brief.md")).expect("golden brief");
    let expected = recorded.strip_suffix('\n').unwrap_or(&recorded);
    let text = template_brief(&payload().brief_input());
    assert_eq!(text, expected);
}

#[test]
fn the_same_input_renders_the_same_bytes() {
    let record = payload();
    let first = template_brief(&record.brief_input());
    let second = template_brief(&record.brief_input());
    assert_eq!(first, second);
}

#[test]
fn every_cve_in_the_brief_was_in_the_input() {
    let mut mine = item("CVE-2026-1");
    mine.products = vec!["linux".to_string()];
    mine.cves = vec!["CVE-2026-1".to_string()];
    let mut other = item("CVE-2026-2");
    other.products = vec!["sap".to_string()];
    let feeds = Feeds {
        nvd: vec![mine, other],
        ..Feeds::default()
    };
    let (sections, stats) = build_digest(&feeds, &inventory(), &seen(&[]));
    let input: Vec<String> = rows(&sections)
        .iter()
        .flat_map(|row| row.cves.iter().cloned())
        .collect();
    let text = template_brief(&BriefInput {
        window_hours: 26,
        sections: &sections,
        stats: &stats,
        inventory: &inventory(),
        collector_errors: &[],
    });
    let claimed = cves_in(&text);
    assert!(!claimed.is_empty());
    for cve in &claimed {
        assert!(input.contains(cve), "{cve} was claimed but never read");
    }
    assert!(!claimed.contains("CVE-2026-9999"));
    assert_eq!(sections.industry[0].id, "CVE-2026-2");
}

#[test]
fn nothing_new_says_so_and_names_a_broken_feed() {
    let (_, stats) = build_digest(&Feeds::default(), &inventory(), &seen(&[]));
    let quiet = nothing_new(26, &stats, &[]);
    assert!(quiet.contains("No new advisories"));
    assert!(!quiet.contains("could not read"));

    let broken = nothing_new(26, &stats, &["KEV: HTTP 503".to_string()]);
    assert!(broken.contains("could not read: KEV: HTTP 503"));
}

#[test]
fn long_brief_is_trimmed_below_discords_limit() {
    let text = (0..6)
        .map(|i| format!("## SECTION {i}\n{}", "detail line ".repeat(40)))
        .collect::<Vec<_>>()
        .join("\n");
    assert!(text.chars().count() > 1850);
    let fitted = fit_for_chat(&text, 1850);
    assert!(fitted.chars().count() <= 1900, "{} chars", fitted.chars().count());
    assert!(fitted.contains("trimmed to fit"));
    assert!(fitted.contains("## SECTION 0"));
}

#[test]
fn short_brief_is_untouched() {
    let text = "## ACT NOW\nnothing new";
    assert_eq!(fit_for_chat(text, 1850), text);
}

#[test]
fn trim_protects_repo_and_server() {
    let advisories = format!(
        "## ACT NOW\n{}\n## WATCH\n{}",
        "long advisory line ".repeat(60),
        "x ".repeat(400)
    );
    let block = format!("## REPO\n- {}\n## SERVER\n- {}", "r".repeat(400), "s".repeat(400));
    let out = fit_for_chat(&format!("{advisories}\n{block}"), 1200);
    assert!(out.contains(&"r".repeat(400)));
    assert!(out.contains(&"s".repeat(400)));
    assert!(out.chars().count() <= 1400, "{} chars", out.chars().count());
}
