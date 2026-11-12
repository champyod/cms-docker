//! The waiver register: how many are live, when the next review is due, how many
//! have already expired. A register that cannot be read is absent, not empty.

use std::path::Path;

use chrono::NaiveDate;

use crate::fleet_state::Waivers;

const REGISTER: &str = "cms-docker-major/security/waivers.json";

/// `(count, next review, expired)`; `None` when the file is missing or unreadable.
pub fn waivers_at(hub: &Path, today: NaiveDate) -> Option<Waivers> {
    let text = std::fs::read_to_string(hub.join(REGISTER)).ok()?;
    let data: serde_json::Value = serde_json::from_str(&text).ok()?;
    let rows = match &data {
        serde_json::Value::Object(map) => map.get("waivers")?,
        serde_json::Value::Array(_) => &data,
        _ => return None,
    };
    let rows = rows.as_array()?;
    let mut dates: Vec<String> = Vec::new();
    let mut expired = 0usize;
    for row in rows {
        let raw = row
            .get("reviewBy")
            .and_then(|value| value.as_str())
            .unwrap_or("");
        let date: String = raw.chars().take(10).collect();
        if date.is_empty() {
            continue;
        }
        if is_expired(&date, today) {
            expired += 1;
        }
        dates.push(date);
    }
    dates.sort();
    Some(Waivers {
        count: rows.len(),
        next: dates.first().cloned().unwrap_or_default(),
        expired,
    })
}

fn is_expired(date: &str, today: NaiveDate) -> bool {
    match NaiveDate::parse_from_str(date, "%Y-%m-%d") {
        Ok(parsed) => parsed < today,
        Err(_) => false,
    }
}
