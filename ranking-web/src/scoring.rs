use std::cmp::Ordering;
use std::collections::BTreeMap;

use crate::board;
use crate::overrides::{Overrides, TaskSnapshot};

pub use crate::board::BoardRow;
pub use crate::ledger::{Ledger, SkippedSubchanges};
pub use crate::score::{
    parse_extra, Score, ScoreError, ScoreMode, Subchange, Submission, SubmissionEntry, TaskMode,
};

/// Replays the projection into a scoreboard. Subchanges are applied in (time, key)
/// order, which is the order Score.create_subchange keeps them in after any
/// out-of-order arrival forces a reset.
///
/// WHY no snapshot: this entry point applies no overrides, so nothing is hidden and no dropped
/// row can be attributed to a hide — every one it reports is `unknown_task`, which is the honest
/// answer without one. The store, which holds both, calls `assemble_with`.
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
        &TaskSnapshot::default(),
    )
}

/// As assemble, but with the active overrides, each user's team folded into the existing
/// single pass rather than a second query or a nested scan, and the projection snapshot the
/// dropped rows are classified against.
pub fn assemble_with(
    tasks: &[TaskMode],
    submissions: &[Submission],
    subchanges: &[Subchange],
    overrides: &Overrides,
    teams: &BTreeMap<String, String>,
    snapshot: &TaskSnapshot,
) -> Result<Ledger, ScoreError> {
    let mut skipped = SkippedSubchanges::default();
    let mut scores = project_scores(tasks, submissions, snapshot, &mut skipped);
    replay_subchanges(
        &mut scores,
        submissions,
        subchanges,
        &mut skipped,
        overrides,
        tasks,
    );
    Ok(finish(scores, skipped, overrides, teams, tasks))
}

/// One Score per user/task pair, keyed by the pair a subchange resolves back to.
fn project_scores(
    tasks: &[TaskMode],
    submissions: &[Submission],
    snapshot: &TaskSnapshot,
    skipped: &mut SkippedSubchanges,
) -> BTreeMap<(String, String), Score> {
    let mut scores: BTreeMap<(String, String), Score> = BTreeMap::new();
    for submission in submissions {
        let mode = tasks
            .iter()
            .find(|task| task.key == submission.task)
            .map(|task| task.mode);
        let Some(mode) = mode else {
            // The snapshot, not the override sets, answers this: asking them saw only the task-target shape.
            if snapshot.announces(&submission.task) {
                skipped.hidden_task += 1;
            } else {
                skipped.unknown_task += 1;
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
    skipped: &mut SkippedSubchanges,
    overrides: &Overrides,
    tasks: &[TaskMode],
) {
    let task_contest: BTreeMap<&str, i32> = tasks
        .iter()
        .map(|task| (task.key.as_str(), task.contest_id))
        .collect();
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
        // Before the owner lookup: a frozen change is the freeze working, not a dropped row.
        let Some((user, task)) = owners.get(change.submission.as_str()) else {
            skipped.orphan += 1;
            continue;
        };
        let frozen_at = task_contest
            .get(task)
            .and_then(|contest_id| overrides.scope(*contest_id).frozen_at());
        if frozen_at.is_some_and(|cutoff| change.time > cutoff) {
            continue;
        }
        if let Some(score) = scores.get_mut(&(user.to_string(), task.to_string())) {
            score.append(change);
        }
        // Counted by its submission's cause, never here: one row, one cause, or the total double-counts.
    }
}

/// The one pass that builds the grid, the history and the board, applying overrides by key.
fn finish(
    scores: BTreeMap<(String, String), Score>,
    skipped: SkippedSubchanges,
    overrides: &Overrides,
    teams: &BTreeMap<String, String>,
    tasks: &[TaskMode],
) -> Ledger {
    let mut ledger = Ledger {
        skipped_subchanges: skipped,
        skipped_overrides: overrides.skipped(),
        ..Ledger::default()
    };
    let board_hidden = overrides.board_hidden();
    let mut merged: Vec<(String, String, i64, f64)> = Vec::new();
    let mut rows: BTreeMap<(i32, String), BoardRow> = BTreeMap::new();
    let meta: BTreeMap<&str, (i32, &str)> = tasks
        .iter()
        .map(|task| (task.key.as_str(), (task.contest_id, task.contest.as_str())))
        .collect();
    for ((user, task), score) in &scores {
        let team = teams.get(user).map(String::as_str);
        let Some((contest_id, contest)) = meta.get(task.as_str()).copied() else {
            continue;
        };
        let scope = overrides.scope(contest_id);
        // Gates every output, not just the row: /history and /sublist must not serve what /board withholds.
        if board_hidden || board::is_hidden(scope, user, team) {
            continue;
        }
        if score.value() > 0.0 {
            ledger
                .scores
                .entry(user.clone())
                .or_default()
                .insert(task.clone(), score.value());
        }
        board::record_row(
            &mut rows,
            scope,
            contest_id,
            contest,
            user,
            team,
            score.value(),
        );
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
