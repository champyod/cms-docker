//! .env KEY=VALUE parser for repo-root environment files.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

pub const CORE_ENV_FILE: &str = ".env.core";

/// Walks up from the current directory until a directory containing
/// `.env.core` is found; falls back to the current directory.
pub fn repo_root() -> PathBuf {
    let mut dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    for _ in 0..12 {
        if dir.join(CORE_ENV_FILE).is_file() {
            return dir;
        }
        if !dir.pop() {
            break;
        }
    }
    PathBuf::from(".")
}

/// Parses every non-comment KEY=VALUE line into a map.
pub fn parse(path: &Path) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let Ok(content) = std::fs::read_to_string(path) else {
        return map;
    };
    for line in content.lines() {
        if let Some((key, value)) = split_pair(line) {
            map.insert(key.to_string(), value.to_string());
        }
    }
    map
}

fn split_pair(line: &str) -> Option<(&str, &str)> {
    let line = line.trim();
    if line.is_empty() || line.starts_with('#') {
        return None;
    }
    let (key, value) = line.split_once('=')?;
    Some((key.trim(), value.trim()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_pairs_and_skips_comments() {
        assert_eq!(
            split_pair("POSTGRES_USER=cmsuser"),
            Some(("POSTGRES_USER", "cmsuser"))
        );
        assert_eq!(split_pair("# comment"), None);
        assert_eq!(split_pair(""), None);
    }

    #[test]
    fn parses_file_content() {
        let dir = std::env::temp_dir().join("cms-tui-env-test");
        std::fs::create_dir_all(&dir).expect("create temp dir");
        let file = dir.join(CORE_ENV_FILE);
        std::fs::write(&file, "A=1\n# c\nB = spaced \n").expect("write temp env");
        let map = parse(&file);
        assert_eq!(map.get("A").map(String::as_str), Some("1"));
        assert_eq!(map.get("B").map(String::as_str), Some("spaced"));
        std::fs::remove_file(&file).ok();
    }
}
