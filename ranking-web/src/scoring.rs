use std::cmp::Ordering;
use std::collections::BTreeMap;

use crate::board;
use crate::overrides::Overrides;

pub use crate::board::BoardRow;
pub use crate::score::{
    Score, ScoreError, ScoreMode, Subchange, Submission, SubmissionEntry, TaskMode,
};

/// The scoreboard, assembled from the projection.
#[derive(Debug, Default, Clone)]
pub struct Ledger {
    scores: BTreeMap<String, BTreeMap<String, f64>>,
    history: Vec<(String, String, i64, f64)>,
    submissions: Vec<SubmissionEntry>,
    board: Vec<BoardRow>,
    skipped_subchanges: usize,
    skipped_overrides: usize,
}

impl Ledger {
    /// Scores strictly above zero, the way ScoreHandler filters them.
    pub fn scores(&self) -> &BTreeMap<String, BTreeMap<String, f64>> {
        &self.scores
    }

    pub fn history(&self) -> &[(String, String, i64, f64)] {
        &self.history
    }

    /// The override-shaped board: hidden rows gone, guests added, name/score/rank set.
    pub fn board(&self) -> &[BoardRow] {
        &self.board
    }

    pub fn skipped_subchanges(&self) -> usize {
        self.skipped_subchanges
    }

    pub fn skipped_overrides(&self) -> usize {
        self.skipped_overrides
    }

    /// One user's submissions, ordered by (task, time) the way the Python
    /// SubListHandler sorted them. A user with none yields an empty list, which is
    /// the route's honest answer rather than a 404.
    pub fn sublist(&self, user: &str) -> Vec<&SubmissionEntry> {
        let mut entries: Vec<&SubmissionEntry> = self
            .submissions
            .iter()
            .filter(|entry| entry.user == user)
            .collect();
        entries.sort_by(|left, right| {
            left.task
                .cmp(&right.task)
                .then_with(|| left.time.cmp(&right.time))
                .then_with(|| left.key.cmp(&right.key))
        });
        entries
    }
}

/// Replays the projection into a scoreboard. Subchanges are applied in (time, key)
/// order, which is the order Score.create_subchange keeps them in after any
/// out-of-order arrival forces a reset.
pub fn assemble(
    tasks: &[TaskMode],
    submissions: &[Submission],
    subchanges: &[Subchange],
) -> Result<Ledger, ScoreError> {
    assemble_with(
        tasks,
        submissions,
        subchanges,
        &Overrides::default(),
        &BTreeMap::new(),
    )
}

/// As assemble, but with the active overrides and each user's team folded into the
/// existing single pass rather than a second query or a nested scan.
pub fn assemble_with(
    tasks: &[TaskMode],
    submissions: &[Submission],
    subchanges: &[Subchange],
    overrides: &Overrides,
    teams: &BTreeMap<String, String>,
) -> Result<Ledger, ScoreError> {
    let mut skipped = 0;
    let mut scores = project_scores(tasks, submissions, &mut skipped);
    replay_subchanges(&mut scores, submissions, subchanges, &mut skipped);
    Ok(finish(scores, skipped, overrides, teams))
}

/// One Score per user/task pair, keyed by the pair a subchange resolves back to.
fn project_scores(
    tasks: &[TaskMode],
    submissions: &[Submission],
    skipped: &mut usize,
) -> BTreeMap<(String, String), Score> {
    let mut scores: BTreeMap<(String, String), Score> = BTreeMap::new();
    for submission in submissions {
        let mode = tasks
            .iter()
            .find(|task| task.key == submission.task)
            .map(|task| task.mode);
        let Some(mode) = mode else {
            *skipped += 1;
            continue;
        };
        scores
            .entry((submission.user.clone(), submission.task.clone()))
            .or_insert_with(|| Score::new(mode))
            .register(&submission.key, submission.time);
    }
    scores
}

fn replay_subchanges(
    scores: &mut BTreeMap<(String, String), Score>,
    submissions: &[Submission],
    subchanges: &[Subchange],
    skipped: &mut usize,
) {
    let owners: BTreeMap<&str, (&str, &str)> = submissions
        .iter()
        .map(|submission| {
            (
                submission.key.as_str(),
                (submission.user.as_str(), submission.task.as_str()),
            )
        })
        .collect();
    let mut ordered: Vec<&Subchange> = subchanges.iter().collect();
    ordered.sort_by(|left, right| {
        left.time
            .cmp(&right.time)
            .then_with(|| left.key.cmp(&right.key))
    });
    for change in ordered {
        let Some((user, task)) = owners.get(change.submission.as_str()) else {
            *skipped += 1;
            continue;
        };
        if let Some(score) = scores.get_mut(&(user.to_string(), task.to_string())) {
            score.append(change);
        }
    }
}

/// The one pass that builds the grid, the history and the board, applying overrides by key.
fn finish(
    scores: BTreeMap<(String, String), Score>,
    skipped: usize,
    overrides: &Overrides,
    teams: &BTreeMap<String, String>,
) -> Ledger {
    let mut ledger = Ledger {
        skipped_subchanges: skipped,
        skipped_overrides: overrides.skipped(),
        ..Ledger::default()
    };
    let mut merged: Vec<(String, String, i64, f64)> = Vec::new();
    let mut rows: BTreeMap<String, BoardRow> = BTreeMap::new();
    for ((user, task), score) in &scores {
        let team = teams.get(user).map(String::as_str);
        if !board::is_hidden(overrides, user, team) {
            if score.value() > 0.0 {
                ledger
                    .scores
                    .entry(user.clone())
                    .or_default()
                    .insert(task.clone(), score.value());
            }
            board::record_row(&mut rows, overrides, user, team, score.value());
        }
        for (time, change) in score.history() {
            merged.push((user.clone(), task.clone(), *time, *change));
        }
        ledger.submissions.extend(score.entries(user, task));
    }
    sort_history(&mut merged);
    ledger.history = merged;
    ledger.board = board::rank_rows(rows, overrides);
    ledger
}

fn sort_history(entries: &mut [(String, String, i64, f64)]) {
    entries.sort_by(|left, right| {
        left.2
            .cmp(&right.2)
            .then_with(|| left.3.partial_cmp(&right.3).unwrap_or(Ordering::Equal))
            .then_with(|| left.0.cmp(&right.0))
            .then_with(|| left.1.cmp(&right.1))
    });
}
