//! The prompt: the system contract, the fleet context and the exact input rows.

use std::collections::BTreeSet;

use serde_json::{json, Value};

use crate::model::Advisory;
use crate::record::RunRecord;
use crate::text::take_chars;

const SYSTEM: &str = r###"You write the daily security brief for one small operator's fleet and nothing else.

HARD RULES
- Use ONLY the items in INPUT. Never add a CVE, product, version or vendor that is not there.
- Never say a component is safe or patched unless INPUT says so. Absence of an item is not evidence.
- Every bullet must carry its CVE/advisory id and its URL exactly as given.
- If INPUT is empty for a section, write "nothing new" for that section and nothing else.
- British-neutral, terse, no hype, no emoji other than the section markers below.
- Total under 2600 characters. Plain Discord markdown.

FLEET CONTEXT (for judging relevance, not for claims)
{fleet}

"## TODAY FOR YOU" is not a summary of the advisories: it states what the run read
(INPUT.run counts), which feeds failed, and — when a feed failed — that absence
from ACT NOW is therefore unverified. One or two lines, no restating of bullets.

OUTPUT FORMAT, exactly these headings in this order:
## ACT NOW
## WATCH
## INDUSTRY
## NEWS
## TODAY FOR YOU
"###;

fn fleet_summary(record: &RunRecord) -> String {
    let mut rows: Vec<String> = record
        .inventory
        .products
        .values()
        .map(|product| {
            let versions: Vec<String> = product.versions.iter().take(3).cloned().collect();
            format!("{}: {}", product.name, versions.join(", "))
        })
        .collect();
    rows.sort();
    let hosts = record
        .inventory
        .hosts
        .iter()
        .map(|host| format!("{} = {} kernel {}", host.name, host.os, host.kernel))
        .collect::<Vec<_>>()
        .join("; ");
    format!("versions: {}\nhosts: {}", rows.join("; "), hosts)
}

fn slim_item(item: &Advisory) -> Value {
    let mut value = serde_json::to_value(item).unwrap_or(Value::Null);
    if let Some(map) = value.as_object_mut() {
        map.insert(
            "summary".to_string(),
            Value::String(take_chars(&item.summary, 200)),
        );
    }
    value
}

fn items_json(items: &[Advisory]) -> Value {
    Value::Array(items.iter().map(slim_item).collect())
}

/// Same fields as the Python payload: what the run read, then the four lists.
fn input_block(record: &RunRecord) -> String {
    let hosts: Vec<String> = record
        .inventory
        .hosts
        .iter()
        .map(|host| format!("{}: {}, kernel {}", host.name, host.os, host.kernel))
        .collect();
    let value = json!({
        "window_hours": record.window_hours,
        "run": {
            "advisories_read": record.stats.merged,
            "touching_your_stack": record.stats.ours,
            "new_this_window": record.stats.fresh,
            "feeds_that_failed": &record.collector_errors,
            "hosts": hosts,
        },
        "act_now": items_json(&record.sections.act_now),
        "watch": items_json(&record.sections.watch),
        "industry": items_json(&record.sections.industry),
        "news": &record.sections.news,
        "collector_errors": &record.collector_errors,
    });
    serde_json::to_string_pretty(&value).unwrap_or_else(|_| "{}".to_string())
}

pub fn build(record: &RunRecord) -> String {
    let system = SYSTEM.replace("{fleet}", &fleet_summary(record));
    format!("{system}\nINPUT\n{}", input_block(record))
}

/// Every id the brief is allowed to name: section item ids and their CVEs.
pub fn allowed_ids(record: &RunRecord) -> BTreeSet<String> {
    let mut ids = BTreeSet::new();
    let rows = record
        .sections
        .act_now
        .iter()
        .chain(&record.sections.watch)
        .chain(&record.sections.industry);
    for item in rows {
        if !item.id.is_empty() {
            ids.insert(item.id.clone());
        }
        for cve in &item.cves {
            if !cve.is_empty() {
                ids.insert(cve.clone());
            }
        }
    }
    ids
}
