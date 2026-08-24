//! Git branch / ahead-behind collector.

use std::path::Path;

use anyhow::{Context, Result};
use tokio::process::Command;

use crate::data::env;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitInfo {
    pub branch: String,
    pub ahead: i64,
    pub behind: i64,
}

/// Current branch plus divergence from origin/main; None outside a repo.
pub async fn info() -> Option<GitInfo> {
    let root = env::repo_root();
    let branch = git(&root, ["rev-parse", "--abbrev-ref", "HEAD"])
        .await
        .ok()?;
    let ahead = rev_count(&root, "origin/main..HEAD").await.ok()?;
    let behind = rev_count(&root, "HEAD..origin/main").await.ok()?;
    Some(GitInfo {
        branch: branch.trim().to_string(),
        ahead,
        behind,
    })
}

async fn rev_count(root: &Path, range: &str) -> Result<i64> {
    let out = git(root, ["rev-list", "--count", range]).await?;
    out.trim()
        .parse::<i64>()
        .context("non-numeric rev-list count")
}

async fn git<const N: usize>(dir: &Path, args: [&str; N]) -> Result<String> {
    let output = Command::new("git")
        .current_dir(dir)
        .args(args)
        .output()
        .await
        .context("git command failed to spawn")?;
    if !output.status.success() {
        anyhow::bail!("git exited with {}", output.status);
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}
