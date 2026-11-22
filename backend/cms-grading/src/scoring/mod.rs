//! What a participation's submissions are worth on one task.
//!
//! A score here is never derived: a score type already decided what each submission is worth,
//! and this module decides which of those numbers the task's score mode reads. [`Submission`]
//! and its [`ResultColumns`] are values rather than a database read — `cms-db`'s result record
//! carries none of the score columns, and a caller that read a result holds them anyway — so
//! every mode is exercised with no database, no clock and no rows.
//!
//! The three modes are one function each because they disagree about the same thing: what an
//! unscored submission is worth. [`max`] and [`max_subtask`] never see one; [`max_tokened_last`]
//! reads the last submission as zero when it is unscored, because that submission is half of
//! the answer rather than an entry in a maximum.
//!
//! [`task_score`] is the entry point and holds the part a mode cannot: it drops the
//! non-official submissions, reads the rest in the order they were sent, and answers whether
//! the participation still has one unscored. That last answer is about the participation, so a
//! contestant whose score is settled is not reported pending because of a submission the mode
//! was told to ignore.
//!
//! [`compute_changes_for_dataset`] answers the question a replacement asks before it is made:
//! which submissions would move, and by how much, if the active dataset were swapped for
//! another one of the same task. It compares the score, the public score and the ranking
//! details, because those are what a contestant and the ranking server read.
//!
//! # Panics
//!
//! Three caller mistakes, each refused with the reference's message rather than answering
//! something nobody should publish: [`task_score`] asked for a public score restricted to
//! tokened submissions, [`max_tokened_last`] handed no submission at all, and
//! [`compute_changes_for_dataset`] handed two datasets of different tasks.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use cms_db::ScoreMode;

mod delta;
mod modes;
mod participation;
mod task_score;

pub use delta::{compute_changes_for_dataset, DatasetScores, ScoreColumns, SubmissionScoreDelta};
pub use modes::{max, max_subtask, max_tokened_last};
pub use participation::{Contribution, Counted, ResultColumns, Submission, SubmittedAt};
pub use task_score::{task_score, TaskScore};

/// The two task columns the aggregation reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TaskSettings {
    /// `tasks.score_mode`: which of the three modes turns submissions into a score.
    pub score_mode: ScoreMode,
    /// `tasks.score_precision`, the decimal places [`ScoreOptions::rounded`] rounds at.
    pub score_precision: u32,
}

/// What a caller asks of [`task_score`].
///
/// A struct rather than three parameters because three booleans at a call site read as one:
/// `task_score(&submissions, task, false, true, false)` names neither the column nor the
/// submissions, and the two combinations that matter are the two that are easy to transpose.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ScoreOptions {
    /// Read `public_score` instead of `score`.
    pub public: bool,
    /// Read only the submissions a token made visible.
    pub only_tokened: bool,
    /// Round the answer at the task's `score_precision`.
    pub rounded: bool,
}
