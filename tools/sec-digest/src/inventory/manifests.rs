//! Manifest readers: package.json, Cargo.lock, pip constraints and the learn docs.

use std::fs;
use std::path::Path;
use std::sync::LazyLock;

use regex::Regex;

use super::scan::{bucket, rel};
use super::Inventory;

static PIP_PIN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^([A-Za-z0-9_.-]+)==([\w.]+)").expect("static pip pin"));
static DOC_VERSION: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(\d+(?:\.\d+)+)").expect("static doc version"));

pub fn npm(inv: &mut Inventory, project: &Path, root: &Path) {
    let path = project.join("package.json");
    let Ok(text) = fs::read_to_string(&path) else {
        return;
    };
    let Ok(data) = serde_json::from_str::<serde_json::Value>(&text) else {
        return;
    };
    let where_ = rel(&path, root);
    for field in ["dependencies", "devDependencies"] {
        let Some(deps) = data.get(field).and_then(|value| value.as_object()) else {
            continue;
        };
        for (name, version) in deps {
            let raw = version.as_str().unwrap_or_default();
            let cleaned = raw.trim_start_matches(['^', '~', '>', '=', '<']);
            bucket(&mut inv.npm, name, cleaned, &where_);
        }
    }
}

/// Cargo.lock is TOML; only `[[package]]` name/version pairs matter here, so the
/// block shape is read directly instead of pulling a TOML parser for four fields.
pub fn cargo_lock(inv: &mut Inventory, path: &Path, root: &Path) {
    let Ok(text) = fs::read_to_string(path) else {
        return;
    };
    let where_ = rel(path, root);
    let mut name = String::new();
    let mut version = String::new();
    for line in text.lines() {
        let line = line.trim();
        if line == "[[package]]" {
            if !name.is_empty() {
                bucket(&mut inv.cargo, &name, &version, &where_);
            }
            name.clear();
            version.clear();
        } else if let Some(value) = line.strip_prefix("name = ") {
            name = value.trim_matches('"').to_string();
        } else if let Some(value) = line.strip_prefix("version = ") {
            // `version = 4` at the top of the file is the lockfile format, not a crate.
            if !name.is_empty() {
                version = value.trim_matches('"').to_string();
            }
        }
    }
    if !name.is_empty() {
        bucket(&mut inv.cargo, &name, &version, &where_);
    }
}

pub fn pip_constraints(inv: &mut Inventory, path: &Path, root: &Path) {
    let Ok(text) = fs::read_to_string(path) else {
        return;
    };
    let where_ = rel(path, root);
    for line in text.lines() {
        if let Some(caps) = PIP_PIN.captures(line.trim()) {
            bucket(&mut inv.pip, &caps[1], &caps[2], &where_);
        }
    }
}

/// `cms-learn/docs/dependencies.md` is that repo's declared inventory.
pub fn learn_docs(inv: &mut Inventory, learn: &Path) {
    let path = learn.join("docs/dependencies.md");
    let Ok(text) = fs::read_to_string(&path) else {
        return;
    };
    let mut section = String::new();
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("## ") {
            section = rest.trim().to_string();
        }
        if !line.starts_with('|') || line.chars().all(|c| "-|: ".contains(c)) {
            continue;
        }
        let cells: Vec<String> = line
            .trim_matches('|')
            .split('|')
            .map(|cell| cell.trim().trim_matches(['`', '*']).to_string())
            .collect();
        if cells.len() < 2 {
            continue;
        }
        let first = cells[0].to_lowercase();
        if ["package", "crate", "image", "tool"].contains(&first.as_str()) {
            continue;
        }
        let Some(caps) = DOC_VERSION.captures(&cells[1]) else {
            continue;
        };
        let where_ = format!("cms-learn/docs/dependencies.md ({section})");
        let short = cells[0].rsplit('/').next().unwrap_or(&cells[0]).to_string();
        if section.to_lowercase().starts_with("image") {
            bucket(&mut inv.images, &short, &caps[1], &where_);
        } else {
            bucket(&mut inv.docs, &short, &caps[1], &where_);
        }
    }
}
