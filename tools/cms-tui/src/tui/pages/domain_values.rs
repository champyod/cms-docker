//! Where a domain-form row's current value comes from, read off this box.
//!
//! WHY `.env` is consulted first: `__domain.sh` sources `.env` under `set -a` before it
//! evaluates any default, so on a configured box `.env` holds the value the next run will
//! actually use. Prefilling from `config.toml` alone would show the operator a stale plan
//! on exactly the box where they are least able to spot it.

use std::collections::BTreeMap;
use std::path::Path;

use super::domain_fields::{all_specs, build_field, source_keys, FieldSpec};
use crate::core::config::{read_env_file, read_toml};
use crate::tui::components::config_form::ConfigForm;

/// The `config.toml` sections this form reads.
const SECTIONS: [&str; 2] = ["admin", "contest"];

/// Every key this form can be seeded from, flattened out of the two files.
#[derive(Default)]
struct SeededValues {
    env: BTreeMap<String, String>,
    config: BTreeMap<String, String>,
}

impl SeededValues {
    /// The value for `key`, with `.env` winning because the script sources it first.
    fn lookup(&self, key: &str) -> &str {
        self.env
            .get(key)
            .or_else(|| self.config.get(key))
            .map_or("", String::as_str)
    }
}

/// Builds the domain form from whatever the box currently has configured.
#[must_use]
pub fn form_from_disk(repo_root: &Path) -> ConfigForm {
    let seeded = read_seeded_values(repo_root);
    let fields = all_specs().map(|spec| build_field(spec, seeded_for(spec, &seeded)));
    ConfigForm::new(fields.collect())
}

/// The current value for `spec`, or `""` when nothing on disk backs the row.
fn seeded_for<'a>(spec: &FieldSpec, seeded: &'a SeededValues) -> &'a str {
    spec.key.map_or("", |key| seeded.lookup(key))
}

/// Reads both files, treating anything unreadable as "nothing configured".
fn read_seeded_values(repo_root: &Path) -> SeededValues {
    SeededValues {
        env: read_env_file(&repo_root.join(".env")).unwrap_or_default(),
        config: read_config(repo_root),
    }
}

/// Collects the keys the form cares about out of every section of `config.toml`.
///
/// WHY every section rather than only `[admin]`: `CONTEST_DOMAIN` is the operator's OJ
/// domain but is configured under `[contest]`, and reading only `[admin]` left that row
/// blank on a box that had it set.
fn read_config(repo_root: &Path) -> BTreeMap<String, String> {
    let mut values = BTreeMap::new();
    let Ok(parsed) = read_toml(&repo_root.join("config.toml")) else {
        return values;
    };
    for section in SECTIONS {
        let Some(table) = parsed.get(section) else {
            continue;
        };
        for key in source_keys() {
            if let Some(value) = table.get(key).and_then(as_text) {
                values.insert(key.to_string(), value);
            }
        }
    }
    values
}

/// Renders a TOML scalar as the text the form field holds.
///
/// WHY integers and booleans become text: `config.toml` writes every flag as `0`/`1` or a
/// number, and the form has to show the value the script will read, not a TOML type.
fn as_text(value: &toml::Value) -> Option<String> {
    match value {
        toml::Value::String(text) => Some(text.clone()),
        toml::Value::Integer(number) => Some(number.to_string()),
        toml::Value::Boolean(is_on) => Some(i32::from(*is_on).to_string()),
        toml::Value::Float(number) => Some(number.to_string()),
        _ => None,
    }
}

#[cfg(test)]
#[path = "domain_values_tests.rs"]
mod tests;
