use std::cmp::Ordering;
use std::collections::BTreeMap;

use crate::board;
use crate::overrides::Overrides;

pub use crate::board::BoardRow;
pub use crate::score::{
    parse_extra, Score, ScoreError, ScoreMode, Subchange, Submission, SubmissionEntry, TaskMode,
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
    /// Hidden task keys that name no task row: the hide exists but drops nothing, so a
    /// renamed task stops being hidden silently. Filled by the store, which is the only
    /// place that can compare the hides against the task table.
    unknown_task_hides: usize,
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

    /// How many task hides named no task row, so /diagnostics can surface a hide that
    /// silently stopped applying.
    pub fn unknown_task_hides(&self) -> usize {
        self.unknown_task_hides
    }

    /// Records the count the store derived by comparing the hides against the task table.
    /// WHY not a constructor argument: a ledger assembled for another read makes no such
    /// comparison, and zero is then the honest answer.
    pub(crate) fn set_unknown_task_hides(&mut self, unknown_task_hides: usize) {
        self.unknown_task_hides = unknown_task_hides;
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
    let mut scores = project_scores(tasks, submissions, overrides, &mut skipped);
    replay_subchanges(
        &mut scores,
        submissions,
        subchanges,
        &mut skipped,
        overrides.frozen_at(),
    );
    Ok(finish(scores, skipped, overrides, teams))
}

/// One Score per user/task pair, keyed by the pair a subchange resolves back to.
fn project_scores(
    tasks: &[TaskMode],
    submissions: &[Submission],
    overrides: &Overrides,
    skipped: &mut usize,
) -> BTreeMap<(String, String), Score> {
    let mut scores: BTreeMap<(String, String), Score> = BTreeMap::new();
    for submission in submissions {
        let mode = tasks
            .iter()
            .find(|task| task.key == submission.task)
            .map(|task| task.mode);
        let Some(mode) = mode else {
            // WHY a hidden task is not a skip: its absence from `tasks` is the hide doing
            // its job, so counting it would report a healthy hide as malformed rows.
            if !overrides.hides_task(&submission.task) {
                *skipped += 1;
            }
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
    frozen_at: Option<i64>,
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
        // WHY before the owner lookup: a frozen-out change is not a skip, it is the
        // freeze doing its job. Counting it would make a healthy freeze look like a
        // stream of malformed rows on the diagnostics surface.
        if frozen_at.is_some_and(|cutoff| change.time > cutoff) {
            continue;
        }
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
    let board_hidden = overrides.board_hidden();
    let mut merged: Vec<(String, String, i64, f64)> = Vec::new();
    let mut rows: BTreeMap<String, BoardRow> = BTreeMap::new();
    for ((user, task), score) in &scores {
        let team = teams.get(user).map(String::as_str);
        // WHY the hidden test gates every output and not only the board row: a hidden
        // participation must not survive as a score, a history row or a sublist entry
        // either, or /history and /sublist would serve what /board withholds.
        if board_hidden || board::is_hidden(overrides, user, team) {
            continue;
        }
        if score.value() > 0.0 {
            ledger
                .scores
                .entry(user.clone())
                .or_default()
                .insert(task.clone(), score.value());
        }
        board::record_row(&mut rows, overrides, user, team, score.value());
        for (time, change) in score.history() {
            merged.push((user.clone(), task.clone(), *time, *change));
        }
        ledger.submissions.extend(score.entries(user, task));
    }
    sort_history(&mut merged);
    ledger.history = merged;
    // A whole-board hide blanks the board, and must not let guest rows re-enter through rank_rows.
    ledger.board = if board_hidden {
        Vec::new()
    } else {
        board::rank_rows(rows, overrides)
    };
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
