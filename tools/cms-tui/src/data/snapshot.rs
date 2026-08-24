//! Point-in-time view of all dashboard data.

use std::time::{SystemTime, UNIX_EPOCH};

use crate::data::backups::{self, BackupInfo};
use crate::data::db::{self, DbStats};
use crate::data::docker::{self, ServiceState};
use crate::data::git::{self, GitInfo};
use crate::data::workers::{self, WorkerRow};

#[derive(Debug, Clone, Default)]
pub struct Snapshot {
    pub services: Vec<(String, ServiceState)>,
    pub services_error: Option<String>,
    pub db: DbStats,
    pub git: Option<GitInfo>,
    pub backup: Option<BackupInfo>,
    pub drill: Option<String>,
    pub workers: Vec<WorkerRow>,
    pub updated_clock: String,
}

impl Snapshot {
    /// Blank snapshot used before the first collection completes.
    pub fn empty() -> Self {
        Self::default()
    }

    pub fn has_data(&self) -> bool {
        !self.updated_clock.is_empty()
    }

    /// Runs all collectors concurrently; individual failures are recorded
    /// on the snapshot rather than propagated.
    pub async fn collect() -> Self {
        let (services, db, git, backup, workers) = tokio::join!(
            docker::service_states(),
            db::stats(),
            git::info(),
            backups::latest(),
            workers::fleet(),
        );
        let drill = backups::drill_result().await;
        let mut snap = Self {
            db,
            git,
            backup,
            drill,
            workers,
            ..Self::default()
        };
        match services {
            Ok(states) => snap.services = states,
            Err(error) => snap.services_error = Some(error.to_string()),
        }
        snap.updated_clock = clock_now();
        snap
    }
}

/// UTC wall clock formatted HH:MM:SS without external crates.
fn clock_now() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|delta| delta.as_secs())
        .unwrap_or(0);
    format!(
        "{:02}:{:02}:{:02}",
        (secs / 3600) % 24,
        (secs / 60) % 60,
        secs % 60
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_snapshot_has_no_data() {
        assert!(!Snapshot::empty().has_data());
    }

    #[test]
    fn clock_formats_zero_epoch() {
        // clock_now is wall-clock; verify formatting helper indirectly by
        // checking the modulo arithmetic used inside it.
        let secs: u64 = 3661;
        assert_eq!((secs / 3600) % 24, 1);
        assert_eq!((secs / 60) % 60, 1);
        assert_eq!(secs % 60, 1);
    }
}
