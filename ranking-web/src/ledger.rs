use std::collections::BTreeMap;

use crate::board::BoardRow;
use crate::overrides::TaskHideCauses;
use crate::score::SubmissionEntry;

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
    pub(crate) hidden_task: usize,
    pub(crate) unknown_task: usize,
    pub(crate) orphan: usize,
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
    pub(crate) scores: BTreeMap<String, BTreeMap<String, f64>>,
    pub(crate) history: Vec<(String, String, i64, f64)>,
    pub(crate) submissions: Vec<SubmissionEntry>,
    pub(crate) board: Vec<BoardRow>,
    pub(crate) skipped_subchanges: SkippedSubchanges,
    pub(crate) skipped_overrides: usize,
    /// The task hides that named no task row, split by the cause the projection snapshot
    /// explains: the hides that name no task row at all used to reach /diagnostics as one
    /// counter, so a task the projection withholds raised the rename alarm forever. Filled by
    /// the store, which is the only place that holds both the hides and the snapshot.
    pub(crate) task_hides: TaskHideCauses,
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

    /// How many distinct contests the board draws a row for. Read by /diagnostics beside the
    /// override scopes: a per-contest board reports one here per shown contest that has a
    /// participation, where the single folded board reported one for the whole service.
    pub fn contests_on_board(&self) -> usize {
        self.board
            .iter()
            .map(|row| row.contest_id)
            .collect::<std::collections::BTreeSet<_>>()
            .len()
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
