#![allow(dead_code)]

//! Shared fixtures for the parity tests: the same shapes the Python suite used.

use std::collections::BTreeSet;

use chrono::{DateTime, Utc};
use regex::Regex;
use sec_digest::inventory::{Host, Inventory, Product};
use sec_digest::model::Advisory;
use sec_digest::rank::Sections;
use sec_digest::timeutil::parse_dt;

/// The Python suite's NOW: every fixture date is relative to this clock.
pub fn now() -> DateTime<Utc> {
    parse_dt("2026-11-10T09:00:00Z").expect("fixed test clock")
}

/// Same defaults as `item(**kw)` in tests/test_digest.py.
pub fn item(id: &str) -> Advisory {
    let mut advisory = Advisory::new(id, "nvd", "NVD", "u", "2026-11-10T09:00:00+00:00");
    advisory.severity = "critical".to_string();
    advisory.score = Some(9.8);
    advisory.title = "t".to_string();
    advisory.summary = "s".to_string();
    advisory
}

/// Same inventory as the Python suite's INV.
pub fn inventory() -> Inventory {
    let mut inv = Inventory::default();
    inv.products.insert(
        "linux".to_string(),
        Product {
            key: "linux".to_string(),
            name: "Linux kernel".to_string(),
            versions: vec!["5.15.0-203".to_string()],
            ..Product::default()
        },
    );
    inv.products.insert(
        "nginx".to_string(),
        Product {
            key: "nginx".to_string(),
            name: "nginx".to_string(),
            versions: vec!["1.27".to_string()],
            ..Product::default()
        },
    );
    inv.hosts.push(Host {
        name: "hosts".to_string(),
        os: "Ubuntu 22.04".to_string(),
        kernel: "5.15.0-203-generic".to_string(),
        note: String::new(),
    });
    inv
}

pub fn seen(ids: &[&str]) -> BTreeSet<String> {
    ids.iter().map(|id| (*id).to_string()).collect()
}

/// Every row the brief actually surfaces, in section order.
pub fn rows(sections: &Sections) -> Vec<Advisory> {
    sections
        .act_now
        .iter()
        .chain(&sections.watch)
        .chain(&sections.industry)
        .cloned()
        .collect()
}

/// CVE ids mentioned in a rendered brief, for the "never claim what we did not read" rule.
pub fn cves_in(text: &str) -> BTreeSet<String> {
    let pattern = Regex::new(r"CVE-\d{4}-\d+").expect("static CVE pattern");
    pattern
        .find_iter(text)
        .map(|m| m.as_str().to_string())
        .collect()
}
