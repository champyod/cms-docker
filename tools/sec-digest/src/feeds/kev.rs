//! CISA KEV: "exploited in the wild" is the only severity that means *now*.

use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::json;

use super::Feed;
use crate::http;
use crate::inventory::products_in_text;
use crate::model::Advisory;
use crate::timeutil::parse_dt;

const URL: &str = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";
const TTL_SECS: u64 = 6 * 3600;

#[derive(Debug, Deserialize)]
struct KevFeed {
    #[serde(default)]
    vulnerabilities: Vec<KevEntry>,
}

#[derive(Debug, Deserialize)]
struct KevEntry {
    #[serde(rename = "cveID", default)]
    cve_id: String,
    #[serde(rename = "vendorProject", default)]
    vendor_project: String,
    #[serde(default)]
    product: String,
    #[serde(rename = "vulnerabilityName", default)]
    vulnerability_name: String,
    #[serde(rename = "dateAdded", default)]
    date_added: String,
    #[serde(rename = "shortDescription", default)]
    short_description: String,
    #[serde(rename = "requiredAction")]
    required_action: Option<String>,
    #[serde(rename = "knownRansomwareCampaignUse")]
    ransomware: Option<String>,
    #[serde(rename = "dueDate")]
    due_date: Option<String>,
}

/// Parse a KEV document; entries without a readable date are dropped, not guessed.
pub fn parse(body: &str, since: DateTime<Utc>) -> Result<Vec<Advisory>, String> {
    let feed: KevFeed = serde_json::from_str(body).map_err(|e| format!("KEV: not JSON: {e}"))?;
    let mut items = Vec::new();
    for entry in feed.vulnerabilities {
        let Some(added) = parse_dt(&entry.date_added) else {
            continue;
        };
        if added < since {
            continue;
        }
        let name = format!("{} {}", entry.vendor_project, entry.product).to_lowercase();
        let mut item = Advisory::new(
            entry.cve_id.clone(),
            "kev",
            "CISA KEV",
            format!("https://nvd.nist.gov/vuln/detail/{}", entry.cve_id),
            entry.date_added.clone(),
        );
        item.severity = "critical".to_string();
        item.score = Some(10.0);
        item.title = format!(
            "{} {} — {}",
            entry.vendor_project,
            entry.product,
            take_chars(&entry.vulnerability_name, 90)
        );
        item.summary = entry.short_description;
        item.cves = vec![entry.cve_id];
        item.products = products_in_text(&name);
        item.exploited = true;
        item.detail.insert("requiredAction".into(), json!(entry.required_action));
        item.detail.insert("ransomware".into(), json!(entry.ransomware));
        item.detail.insert("dueDate".into(), json!(entry.due_date));
        items.push(item);
    }
    Ok(items)
}

fn take_chars(text: &str, limit: usize) -> String {
    text.chars().take(limit).collect()
}

pub fn collect(since: DateTime<Utc>) -> Result<Feed, String> {
    let fetch = http::get(URL, TTL_SECS).map_err(|e| format!("KEV: {e}"))?;
    let items = parse(&fetch.body, since)?;
    Ok(Feed {
        items,
        warning: fetch.warning,
    })
}
