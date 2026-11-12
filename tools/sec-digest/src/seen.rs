//! Read-only view of the seen-state written by the digest that owns the directory.
//!
//! The Rust build does not write this file yet (delivery is a later step), but
//! reading it keeps "· new" honest instead of marking every row new every run.

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

pub fn load(state_dir: &Path) -> BTreeSet<String> {
    let path = state_dir.join("seen.json");
    let Ok(text) = fs::read_to_string(path) else {
        return BTreeSet::new();
    };
    let Ok(data) = serde_json::from_str::<serde_json::Value>(&text) else {
        return BTreeSet::new();
    };
    data.get("seen")
        .and_then(|value| value.as_object())
        .map(|seen| seen.keys().cloned().collect())
        .unwrap_or_default()
}
