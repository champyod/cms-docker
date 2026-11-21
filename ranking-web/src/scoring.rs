use std::cmp::Ordering;
use std::collections::BTreeMap;

use crate::board;
use crate::overrides::{Overrides, TaskHideCauses, TaskSnapshot};

pub use crate::board::BoardRow;
pub use crate::score::{
    parse_extra, Score, ScoreError, ScoreMode, Subchange, Submission, SubmissionEntry, TaskMode,
};

/// The rows the fold dropped, split by the cause that dropped them.
///
/// WHY the split: this is the counter an operator reads to decide whether the board is missing
/// rows it should have, and as one number it mixed two units and four causes — so hiding a
/// contest (a concealed contest moved it 40 → 466 on prod) read exactly like a data fault, in
/// the one number that has to be believed. The causes partition the total, so the alarm is the
/// two fault causes and the hide cause is the operator's own doing, named rather than excused.
///
/// WHY the hide cause is counted although a hide is not a fault: the replay set is the
/// projection's tasks minus the hides, so a hide IS the reason those rows are gone, and a
/// counter that silently exempts one hide shape while counting the other cannot be trusted for
/// either. `unknown_task` and `orphan` are the two numbers worth chasing.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct SkippedSubchanges {
    hidden_task: usize,
    unknown_task: usize,
    orphan: usize,
}

impl SkippedSubchanges {
    /// The submissions whose task the projection announces and the replay set lacks: a task or
    /// contest hide dropped it, so these rows are gone because the operator hid them.
    pub fn hidden_task(&self) -> usize {
        self.hidden_task
    }

    /// The submissions whose task no drawn task of the projection carries: the push never
    /// announced it, or it belongs to a contest this instance does not draw. A data fault.
    pub fn unknown_task(&self) -> usize {
        self.unknown_task
    }

    /// The subchange rows whose submission the projection does not hold at all. A data fault.
    pub fn orphan(&self) -> usize {
        self.orphan
    }

    /// Every row the fold dropped — the counter's meaning before the split, kept so the panel's
    /// consumer reads what it always read. The three causes partition exactly this set.
    pub fn total(&self) -> usize {
        self.hidden_task + self.unknown_task + self.orphan
    }
}

/// The scoreboard, assembled from the projection.
#[derive(Debug, Default, Clone)]
pub struct Ledger {
    scores: BTreeMap<String, BTreeMap<String, f64>>,
    history: Vec<(String, String, i64, f64)>,
    submissions: Vec<SubmissionEntry>,
    board: Vec<BoardRow>,
    skipped_subchanges: SkippedSubchanges,
    skipped_overrides: usize,
    /// The task hides that named no task row, split by the cause the projection snapshot
    /// explains: the hides that name no task row at all used to reach /diagnostics as one
    /// counter, so a task the projection withholds raised the rename alarm forever. Filled by
    /// the store, which is the only place that holds both the hides and the snapshot.
    task_hides: TaskHideCauses,
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

    /// Every row the fold dropped, so /diagnostics can say whether the board is missing
    /// anything. The causes below partition it.
    pub fn skipped_subchanges(&self) -> usize {
        self.skipped_subchanges.total()
    }

    /// The dropped rows whose task a hide removed — the operator's own doing.
    pub fn hidden_task_subchanges(&self) -> usize {
        self.skipped_subchanges.hidden_task()
    }

    /// The dropped rows whose task no drawn task of the projection carries: the number to chase.
    pub fn unknown_task_subchanges(&self) -> usize {
        self.skipped_subchanges.unknown_task()
    }

    /// The dropped subchange rows whose submission the projection does not hold: the number to
    /// chase.
    pub fn orphan_subchanges(&self) -> usize {
        self.skipped_subchanges.orphan()
    }

    pub fn skipped_overrides(&self) -> usize {
        self.skipped_overrides
    }

    /// How many task hides named no task row, so /diagnostics can surface a hide that silently
    /// stopped applying. It is the three causes below, summed: the meaning this counter already
    /// had, kept so the panel's consumer reads what it always read.
    pub fn unknown_task_hides(&self) -> usize {
        self.task_hides.total()
    }

    /// The hides whose contest the projection holds with no task of it — the CMS knows the
    /// task and the projection withholds it, so nothing was renamed.
    pub fn withheld_task_hides(&self) -> usize {
        self.task_hides.withheld()
    }

    /// The hides naming a task a live contest no longer holds: the stale key a rename leaves,
    /// which is the alarm this counter exists for.
    pub fn renamed_task_hides(&self) -> usize {
        self.task_hides.renamed()
    }

    /// The hides naming neither a projected contest nor a projected task: nothing in the
    /// snapshot explains them.
    pub fn unmatched_task_hides(&self) -> usize {
        self.task_hides.unmatched()
    }

    /// Records the causes the store derived by classifying the hides against the projection
    /// snapshot.
    /// WHY not a constructor argument: a ledger assembled for another read classifies nothing,
    /// and zero is then the honest answer.
    pub(crate) fn set_task_hides(&mut self, task_hides: TaskHideCauses) {
        self.task_hides = task_hides;
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
        overrides.frozen_at(),
    );
    Ok(finish(scores, skipped, overrides, teams))
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
            // WHY the snapshot decides this and not the override sets: the replay set is the
            // projection's tasks minus the hides, so a task the snapshot announces and this set
            // lacks is one a hide dropped — whichever shape the hide took. Asking the overrides
            // directly saw only the task-target shape, because a submission carries no contest,
            // so a whole hidden contest's submissions counted as malformed rows (466 on prod)
            // with nothing wrong. The cause names which it was, so the row is not lost either way.
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
            skipped.orphan += 1;
            continue;
        };
        if let Some(score) = scores.get_mut(&(user.to_string(), task.to_string())) {
            score.append(change);
        }
        // A change whose submission the fold already dropped for its task leaves with it, and is
        // counted by that submission's own cause rather than here: one row, one cause, or the
        // same loss would be reported twice and the causes would stop partitioning the total.
    }
}

/// The one pass that builds the grid, the history and the board, applying overrides by key.
fn finish(
    scores: BTreeMap<(String, String), Score>,
    skipped: SkippedSubchanges,
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
