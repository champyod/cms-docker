//! Compose and Dockerfile readers: which images and which alpine generation.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use regex::Regex;

use super::{Inventory, VersionRecord};

const MAX_DOCKERFILES: usize = 80;

static TAG_SUFFIX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"[-_](alpine|slim|bookworm|bullseye|buster|trixie|noble|jammy|nixos|distroless)$")
        .expect("static image tag suffix")
});
static COMPOSE_IMAGE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"^\s*image:\s*['"]?([a-z0-9][\w./-]*)(?::([\w.$\{\}-]+))?"#)
        .expect("static compose image line")
});
static FROM_LINE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)^\s*FROM\s+([\w./-]+):([\w.-]+)").expect("static FROM line")
});
static ALPINE_GEN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(3\.\d+)").expect("static alpine generation"));
static KERNEL_VERSION: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(\d+\.\d+\.\d+(?:-\d+)?)").expect("static kernel version")
});

pub(crate) fn rel(path: &Path, root: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .display()
        .to_string()
}

/// Normalize a version as the Python tool does: drop a leading `v`, image tag
/// suffixes, and anything that pins a distro rather than a number.
fn clean_version(version: &str) -> String {
    let trimmed = version
        .trim()
        .trim_start_matches(['v', 'V'])
        .trim_matches(|c: char| matches!(c, '`' | '*' | '_' | ' '));
    let without_tag = TAG_SUFFIX.replace(trimmed, "").to_string();
    if !without_tag.is_empty() && !without_tag.chars().any(|c| c.is_ascii_digit()) {
        return String::new();
    }
    without_tag
}

pub fn kernel_version(kernel: &str) -> Option<String> {
    KERNEL_VERSION.captures(kernel).map(|caps| caps[1].to_string())
}

/// Record one version and the file it came from. Idempotent per file.
pub fn bucket(
    map: &mut BTreeMap<String, VersionRecord>,
    name: &str,
    version: &str,
    where_: &str,
) {
    let cleaned = clean_version(version);
    if cleaned.starts_with('$') {
        return;
    }
    let record = map
        .entry(name.to_lowercase())
        .or_insert_with(|| VersionRecord {
            name: name.to_string(),
            ..VersionRecord::default()
        });
    if !cleaned.is_empty() && !record.versions.contains(&cleaned) {
        record.versions.push(cleaned);
    }
    if !record.where_paths.iter().any(|w| w == where_) {
        record.where_paths.push(where_.to_string());
    }
}

fn compose_files(docker: &Path) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = Vec::new();
    for dir in [docker.to_path_buf(), docker.join("docker")] {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with("docker-compose") && name.ends_with(".yml") {
                files.push(entry.path());
            }
        }
    }
    files.sort();
    files
}

pub fn compose_images(inv: &mut Inventory, docker: &Path) {
    for path in compose_files(docker) {
        let Ok(text) = fs::read_to_string(&path) else {
            continue;
        };
        let where_ = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        for line in text.lines() {
            let Some(caps) = COMPOSE_IMAGE.captures(line) else {
                continue;
            };
            let name = &caps[1];
            let tag = caps.get(2).map(|m| m.as_str()).unwrap_or("");
            if name.starts_with("ghcr.io/champyod/") {
                continue;
            }
            if tag.ends_with("-alpine") || tag == "alpine" {
                // Generation comes from the Dockerfiles, not from the tag.
                bucket(&mut inv.images, "alpine", "", &where_);
            }
            let short = name.rsplit('/').next().unwrap_or(name);
            bucket(&mut inv.images, short, tag, &where_);
        }
    }
}

fn find_dockerfiles(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    if depth == 0 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || name == "node_modules" || name == "target" {
                continue;
            }
            find_dockerfiles(&path, depth - 1, out);
        } else if entry.file_name().to_string_lossy().starts_with("Dockerfile") {
            out.push(path);
        }
    }
}

pub fn dockerfiles(inv: &mut Inventory, docker: &Path, root: &Path) {
    let mut files = Vec::new();
    find_dockerfiles(docker, 6, &mut files);
    files.sort();
    files.truncate(MAX_DOCKERFILES);
    for path in files {
        let Ok(text) = fs::read_to_string(&path) else {
            continue;
        };
        let where_ = rel(&path, root);
        for caps in FROM_LINE.captures_iter(&text) {
            let image = &caps[1];
            let tag = &caps[2];
            let is_alpine = image.rsplit('/').next() == Some("alpine") || tag.contains("alpine");
            if !is_alpine {
                continue;
            }
            if let Some(generation) = ALPINE_GEN.captures(tag) {
                bucket(&mut inv.images, "alpine", &generation[1], &where_);
            }
        }
    }
}
