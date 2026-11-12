//! What each checkout says about itself: git locally, `gh` with cwd inside it.
//!
//! `gh` run from the hub root dies with "not a git repository", so every CI and PR
//! query is spawned with the checkout as its working directory. A `gh` that cannot
//! answer becomes the word `gh unavailable`, never an empty CI field.

use std::path::Path;
use std::time::Duration;

use crate::fleet_state::exec::Runner;
use crate::fleet_state::RepoState;
use crate::text::take_chars;

/// A checkout the digest reads; `landing` is the branch CI lands on.
pub struct RepoSpec {
    pub name: &'static str,
    pub path: &'static str,
    pub landing: &'static str,
}

pub const REPOS: [RepoSpec; 2] = [
    RepoSpec {
        name: "cms-docker",
        path: "cms-docker-major",
        landing: "major/admin-panel",
    },
    RepoSpec {
        name: "cms-learn",
        path: "cms-learn",
        landing: "main",
    },
];

fn argv(parts: &[&str]) -> Vec<String> {
    parts.iter().map(|part| (*part).to_string()).collect()
}

fn run_trimmed(runner: &dyn Runner, argv: &[String], cwd: Option<&Path>, secs: u64) -> String {
    runner
        .run(argv, cwd, Duration::from_secs(secs))
        .trim()
        .to_string()
}

/// `%h|%cr|%s`, split into head, relative age and a 70-char subject.
fn read_head(runner: &dyn Runner, path: &Path) -> (String, String, String) {
    let repo = path.to_string_lossy().to_string();
    let argv = argv(&["git", "-C", &repo, "log", "-1", "--format=%h|%cr|%s"]);
    let head = run_trimmed(runner, &argv, None, 10);
    let mut parts = head.splitn(3, '|');
    match (parts.next(), parts.next(), parts.next()) {
        (Some(hash), Some(age), Some(subject)) if !hash.is_empty() => {
            (hash.to_string(), age.to_string(), take_chars(subject, 70))
        }
        _ => (String::new(), String::new(), String::new()),
    }
}

fn read_dirty(runner: &dyn Runner, path: &Path) -> usize {
    let repo = path.to_string_lossy().to_string();
    let argv = argv(&["git", "-C", &repo, "status", "--porcelain"]);
    let status = runner.run(&argv, None, Duration::from_secs(15));
    status
        .lines()
        .filter(|line| !line.trim().is_empty())
        .count()
}

/// `success (CI)`; `running` when the newest run has no conclusion yet.
fn read_ci(runner: &dyn Runner, path: &Path, landing: &str) -> String {
    let argv = argv(&[
        "gh",
        "run",
        "list",
        "--branch",
        landing,
        "--limit",
        "3",
        "--json",
        "conclusion,displayTitle,createdAt",
    ]);
    let text = runner.run(&argv, Some(path), Duration::from_secs(25));
    match serde_json::from_str::<serde_json::Value>(&text) {
        Ok(serde_json::Value::Array(runs)) => match runs.first() {
            Some(run) => {
                let conclusion = run
                    .get("conclusion")
                    .and_then(|value| value.as_str())
                    .filter(|value| !value.is_empty())
                    .unwrap_or("running");
                let title = run
                    .get("displayTitle")
                    .and_then(|value| value.as_str())
                    .unwrap_or("");
                format!("{conclusion} ({})", take_chars(title, 40))
            }
            None => String::new(),
        },
        _ if gh_failed(&text) => "gh unavailable".to_string(),
        _ => String::new(),
    }
}

fn gh_failed(text: &str) -> bool {
    text.contains("__error__") || text.to_lowercase().contains("gh:")
}

/// Open PRs, with the first title cut at 60 chars; a `gh` that failed reads as zero.
fn read_prs(runner: &dyn Runner, path: &Path) -> (usize, String) {
    let argv = argv(&[
        "gh",
        "pr",
        "list",
        "--state",
        "open",
        "--limit",
        "20",
        "--json",
        "number,title",
    ]);
    let text = runner.run(&argv, Some(path), Duration::from_secs(25));
    match serde_json::from_str::<serde_json::Value>(&text) {
        Ok(serde_json::Value::Array(prs)) => {
            let title = prs
                .first()
                .and_then(|pr| pr.get("title"))
                .and_then(|value| value.as_str())
                .map(|value| take_chars(value, 60))
                .unwrap_or_default();
            (prs.len(), title)
        }
        _ => (0, String::new()),
    }
}

pub fn repo_state(runner: &dyn Runner, hub: &Path, spec: &RepoSpec) -> RepoState {
    let mut state = RepoState {
        repo: spec.name.to_string(),
        ..RepoState::default()
    };
    let path = hub.join(spec.path);
    if !path.is_dir() {
        state.error = Some("checkout not found".to_string());
        return state;
    }
    let (head, age, subject) = read_head(runner, &path);
    state.head = head;
    state.age = age;
    state.subject = subject;
    let repo = path.to_string_lossy().to_string();
    state.branch = run_trimmed(
        runner,
        &argv(&["git", "-C", &repo, "rev-parse", "--abbrev-ref", "HEAD"]),
        None,
        10,
    );
    state.dirty = read_dirty(runner, &path);
    state.ci = read_ci(runner, &path, spec.landing);
    let (prs, title) = read_prs(runner, &path);
    state.prs = prs;
    state.pr_title = title;
    state
}
