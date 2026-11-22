//! What replacing a dataset changes, before the replacement is made.
//!
//! `scoring.py:47`. Activating a dataset is a decision about scores, so the reference answers
//! first what would move: for every submission of the task, the score, the public score and the
//! ranking details on the old dataset against the new one. A submission whose three agree is
//! left out entirely, and the columns that agree inside a submission that is reported carry no
//! value — so a caller reads a number only where it changed and cannot mistake an unchanged one
//! for a decision to restore it.
//!
//! The ranking details are compared because the ranking server reads them: two runs that print
//! `10` and `10.0` for the same subtask are a change the server sees, even though the score a
//! contestant reads is the same.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::collections::{BTreeMap, BTreeSet};

use cms_db::SubmissionId;

/// The three columns a dataset replacement can change on one result.
///
/// Narrower than the columns the aggregation reads: a replacement is judged on what a
/// contestant's score and the ranking server see, and the documents are not part of either.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ScoreColumns {
    /// `submission_results.score`, absent on a row that is not scored yet.
    pub score: Option<f64>,
    /// `submission_results.public_score`.
    pub public_score: Option<f64>,
    /// `submission_results.ranking_score_details`, one string per subtask.
    pub ranking_details: Option<Vec<String>>,
}

/// One dataset's results for a task, by the submission each belongs to.
#[derive(Debug, Clone, PartialEq)]
pub struct DatasetScores {
    /// `datasets.task_id`: a replacement only means something within one task.
    pub task: i32,
    /// A submission with no result row on this dataset is absent, which reads the same as a
    /// row of null columns: the reference compares `None` in every case it finds no result.
    pub by_submission: BTreeMap<SubmissionId, ScoreColumns>,
}

/// One submission a replacement would change the score of.
///
/// A field pair is `(old, new)`, and both halves are absent when the columns agree — the
/// reference's own shape, so a caller can tell "unchanged" from "changed to nothing".
#[derive(Debug, Clone, PartialEq)]
pub struct SubmissionScoreDelta {
    /// The submission whose result differs.
    pub submission: SubmissionId,
    /// The old and the new `score`, absent on both when they agree.
    pub old_score: Option<f64>,
    /// See [`Self::old_score`].
    pub new_score: Option<f64>,
    /// The old and the new `public_score`, absent on both when they agree.
    pub old_public_score: Option<f64>,
    /// See [`Self::old_public_score`].
    pub new_public_score: Option<f64>,
    /// The old and the new `ranking_score_details`, absent on both when they agree.
    pub old_ranking_details: Option<Vec<String>>,
    /// See [`Self::old_ranking_details`].
    pub new_ranking_details: Option<Vec<String>>,
}

/// The submissions whose score replaced `old` with `new` would move.
///
/// Only the submissions with a result on at least one of the two datasets can differ, so the
/// two maps' keys are the whole list. They are walked in submission order, where the reference
/// returns its query's order, so the answer is the same on every run.
///
/// # Panics
///
/// Panics when the two datasets belong to different tasks, with the reference's message:
/// comparing them would pair one task's results with another's.
#[must_use]
pub fn compute_changes_for_dataset(
    old: &DatasetScores,
    new: &DatasetScores,
) -> Vec<SubmissionScoreDelta> {
    assert!(
        old.task == new.task,
        "Cannot compare datasets referring to different tasks."
    );

    let submissions: BTreeSet<SubmissionId> = old
        .by_submission
        .keys()
        .chain(new.by_submission.keys())
        .copied()
        .collect();

    let mut changes = Vec::new();
    for submission in submissions {
        let old_columns = columns_of(old, submission);
        let new_columns = columns_of(new, submission);
        let score = differing(old_columns.score, new_columns.score);
        let public_score = differing(old_columns.public_score, new_columns.public_score);
        let ranking_details = differing(old_columns.ranking_details, new_columns.ranking_details);
        if score.is_none() && public_score.is_none() && ranking_details.is_none() {
            continue;
        }

        let (old_score, new_score) = score.unwrap_or((None, None));
        let (old_public, new_public) = public_score.unwrap_or((None, None));
        let (old_ranking, new_ranking) = ranking_details.unwrap_or((None, None));
        changes.push(SubmissionScoreDelta {
            submission,
            old_score,
            new_score,
            old_public_score: old_public,
            new_public_score: new_public,
            old_ranking_details: old_ranking,
            new_ranking_details: new_ranking,
        });
    }

    changes
}

/// The three columns of one submission's result, all null when this dataset has no row for it.
fn columns_of(dataset: &DatasetScores, submission: SubmissionId) -> ScoreColumns {
    dataset
        .by_submission
        .get(&submission)
        .cloned()
        .unwrap_or_default()
}

/// The old and the new value when they differ, and nothing when they agree.
fn differing<T: PartialEq>(old: Option<T>, new: Option<T>) -> Option<(Option<T>, Option<T>)> {
    (old != new).then_some((old, new))
}
