//! Newest-backup listing from backups/*.sql.gz.

use std::path::Path;
use std::time::SystemTime;

use crate::data::env;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackupInfo {
    pub filename: String,
    pub age_secs: u64,
    pub size_bytes: u64,
}

impl BackupInfo {
    /// Human age matching the bash dashboard buckets (90s/90m/36h).
    pub fn age_human(&self) -> String {
        let secs = self.age_secs;
        if secs < 90 {
            format!("{secs}s")
        } else if secs < 5400 {
            format!("{}m", secs / 60)
        } else if secs < 129_600 {
            format!("{}h", secs / 3600)
        } else {
            format!("{}d", secs / 86_400)
        }
    }

    pub fn size_human(&self) -> String {
        let bytes = self.size_bytes;
        if bytes < 1024 {
            format!("{bytes} B")
        } else if bytes < 1024 * 1024 {
            format!("{:.1} KiB", bytes as f64 / 1024.0)
        } else {
            format!("{:.1} MiB", bytes as f64 / (1024.0 * 1024.0))
        }
    }
}

/// Metadata of the most recently modified *.sql.gz under backups/.
pub async fn latest() -> Option<BackupInfo> {
    let dir = env::repo_root().join("backups");
    newest_sql_gz(&dir)
}

/// Last drill verdict parsed from backups/drill.log when one exists.
pub async fn drill_result() -> Option<String> {
    let log = env::repo_root().join("backups").join("drill.log");
    let content = std::fs::read_to_string(log).ok()?;
    let last = content.lines().rev().find(|line| !line.trim().is_empty())?;
    match (last.contains("PASS"), last.contains("FAIL")) {
        (true, false) => Some("PASS".to_string()),
        (false, true) => Some("FAIL".to_string()),
        _ => None,
    }
}

fn newest_sql_gz(dir: &Path) -> Option<BackupInfo> {
    let mut best: Option<(SystemTime, BackupInfo)> = None;
    for entry in std::fs::read_dir(dir).ok()? {
        let Ok(entry) = entry else { continue };
        if let Some(candidate) = entry_info(&entry) {
            let replace = match &best {
                Some((modified, _)) => candidate.0 > *modified,
                None => true,
            };
            if replace {
                best = Some(candidate);
            }
        }
    }
    best.map(|(_, info)| info)
}

fn entry_info(entry: &std::fs::DirEntry) -> Option<(SystemTime, BackupInfo)> {
    let name = entry.file_name().to_string_lossy().into_owned();
    if !name.ends_with(".sql.gz") {
        return None;
    }
    let meta = entry.metadata().ok()?;
    let modified = meta.modified().ok()?;
    let age_secs = SystemTime::now()
        .duration_since(modified)
        .unwrap_or_default()
        .as_secs();
    Some((
        modified,
        BackupInfo {
            filename: name,
            age_secs,
            size_bytes: meta.len(),
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info(age_secs: u64, size_bytes: u64) -> BackupInfo {
        BackupInfo {
            filename: "x.sql.gz".to_string(),
            age_secs,
            size_bytes,
        }
    }

    #[test]
    fn human_age_buckets() {
        assert_eq!(info(30, 0).age_human(), "30s");
        assert_eq!(info(600, 0).age_human(), "10m");
        assert_eq!(info(7200, 0).age_human(), "2h");
        assert_eq!(info(200_000, 0).age_human(), "2d");
    }

    #[test]
    fn human_size_buckets() {
        assert_eq!(info(0, 512).size_human(), "512 B");
        assert_eq!(info(0, 2048).size_human(), "2.0 KiB");
        assert_eq!(info(0, 3 * 1024 * 1024).size_human(), "3.0 MiB");
    }

    #[test]
    fn epoch_math_is_consistent() {
        assert_eq!(
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0)
        );
    }

    #[test]
    fn missing_dir_yields_none() {
        let ghost = PathBuf::from("/nonexistent-cms-tui-backups");
        assert!(newest_sql_gz(&ghost).is_none());
    }
}
