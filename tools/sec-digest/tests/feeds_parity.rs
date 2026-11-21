//! Feed parsing against committed fixtures: windows, product matching, RSS fallback.

use std::fs;

use chrono::{DateTime, Utc};
use sec_digest::feeds::{kev, news, rss, usn};
use sec_digest::timeutil::parse_dt;

const FIXTURES: &str = "tests/fixtures";

fn read(name: &str) -> String {
    fs::read_to_string(format!("{FIXTURES}/{name}")).expect("fixture file")
}

/// The Python suite's clock minus the 26h window.
fn since() -> DateTime<Utc> {
    parse_dt("2026-11-09T07:00:00Z").expect("fixed window start")
}

#[test]
fn kev_keeps_the_window_and_marks_entries_exploited() {
    let items = kev::parse(&read("kev.json"), since()).expect("KEV fixture parses");
    let ids: Vec<&str> = items.iter().map(|item| item.id.as_str()).collect();
    assert_eq!(ids, vec!["CVE-2026-7001", "CVE-2026-7002"]);

    let openssl = &items[0];
    assert_eq!(openssl.kind, "kev");
    assert_eq!(openssl.source, "CISA KEV");
    assert_eq!(openssl.score, Some(10.0));
    assert!(openssl.exploited);
    assert_eq!(openssl.products, vec!["openssl".to_string()]);
    assert_eq!(
        openssl.url,
        "https://nvd.nist.gov/vuln/detail/CVE-2026-7001"
    );
    assert_eq!(
        openssl.title,
        "OpenSSL OpenSSL — OpenSSL Buffer Overread Vulnerability"
    );
    assert_eq!(openssl.detail_str("dueDate"), Some("2026-12-01"));
    // Fortinet is not our software: no product key may be invented for it.
    assert!(items[1].products.is_empty());
}

#[test]
fn kev_rejects_a_document_that_is_not_json() {
    let error = kev::parse("<html>503</html>", since()).expect_err("html is not a KEV catalog");
    assert!(error.starts_with("KEV: not JSON:"));
}

#[test]
fn usn_json_keeps_only_releases_we_run() {
    let items = usn::parse_json(&read("usn.json"), since()).expect("USN fixture parses");
    let ids: Vec<&str> = items.iter().map(|item| item.id.as_str()).collect();
    assert_eq!(ids, vec!["USN-9001-1", "USN-9002-1"]);

    let openssl = &items[0];
    assert_eq!(openssl.products, vec!["openssl".to_string()]);
    assert_eq!(openssl.detail_str("fixed"), Some("jammy 3.0.2-0ubuntu1.19"));
    assert_eq!(
        openssl.detail_list("packages"),
        vec!["libssl3".to_string(), "openssl".to_string()]
    );
    assert_eq!(openssl.cves, vec!["CVE-2026-7001".to_string()]);
    assert_eq!(
        openssl.url,
        "https://ubuntu.com/security/notices/USN-9001-1"
    );

    // nginx is a host package, so the notice survives even without a known product key.
    assert_eq!(items[1].products, vec!["nginx".to_string()]);
    assert_eq!(items[1].severity, "");
}

#[test]
fn usn_rss_fallback_matches_titles_and_is_marked_as_such() {
    let items = usn::parse_rss(&read("usn_rss.xml"), since());
    let ids: Vec<&str> = items.iter().map(|item| item.id.as_str()).collect();
    assert_eq!(ids, vec!["USN-9100-1", "USN-9103-1"]);
    assert_eq!(items[0].source, "Ubuntu USN (RSS)");
    assert_eq!(
        items[0].detail_str("note"),
        Some("RSS fallback: affected packages unverified")
    );
    assert_eq!(items[0].url, "https://ubuntu.com/security/notices/USN-9100-1");
    assert_eq!(items[1].products, vec!["openssl".to_string()]);
}

#[test]
fn rss_titles_lose_cdata_and_markup() {
    let parsed = rss::items(&read("usn_rss.xml"), 10);
    assert_eq!(parsed[1].title, "USN-9101-1: yodl vulnerability");
    assert_eq!(parsed[0].date, "Mon, 09 Nov 2026 18:33:50 +0000");
}

#[test]
fn news_keeps_keyword_stories_inside_the_window() {
    let items = news::parse(&read("news.xml"), "BleepingComputer", since());
    let titles: Vec<&str> = items.iter().map(|item| item.title.as_str()).collect();
    assert_eq!(
        titles,
        vec![
            "Hackers exploit critical OpenSSL flaw in the wild",
            "Ransomware group claims breach of a cloud provider"
        ]
    );
    assert!(items[0].id.starts_with("news:"));
    assert_eq!(items[0].source, "BleepingComputer");
    assert_eq!(items[0].url, "https://example.invalid/openssl");
    // News is context only: it never carries a CVE or a product claim.
    assert!(items.iter().all(|item| item.cves.is_empty()));
    assert!(items.iter().all(|item| item.products.is_empty()));
}
