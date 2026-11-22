//! The three ways a participation's submissions become one score.
//!
//! They differ in exactly the way a ranking feels: `max` takes the best submission, IOI
//! 2013-2016; `max_subtask` sums each subtask's best, IOI's since 2017; and
//! `max_tokened_last` takes the best tokened submission or the last one, IOI 2010-2012.
//!
//! The difference that costs contests is what an unscored submission is worth. For `max` and
//! `max_subtask` it contributes nothing, so a pending submission leaves the score where the
//! last scored one put it. For `max_tokened_last` the *last* submission is one of the two
//! numbers compared, and a pending last counts as `0.0` — the score the contestant would
//! have if it resolved to zero. Reading it as nothing instead would publish an older
//! submission's score for a contestant who has just replaced it.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::collections::BTreeMap;

use crate::scoretypes::{ScoreDetails, Subtask};

use super::Contribution;

/// The number the reference gives the one subtask it falls back to.
const SINGLE_SUBTASK: usize = 1;

/// The maximum over every submission, the score mode IOI 2013-2016 used.
#[must_use]
pub fn max(contributions: &[Contribution<'_>]) -> f64 {
    contributions
        .iter()
        .filter_map(|contribution| contribution.counted)
        .map(|counted| counted.score)
        .fold(0.0, f64::max)
}

/// The sum, over the subtasks, of each subtask's best submission: IOI's mode since 2017.
#[must_use]
pub fn max_subtask(contributions: &[Contribution<'_>]) -> f64 {
    let mut best: BTreeMap<usize, f64> = BTreeMap::new();

    for counted in contributions
        .iter()
        .filter_map(|contribution| contribution.counted)
    {
        // WHY: a submission that never compiled has no document to read and scores nothing.
        if document_is_empty(counted.details) && counted.score == 0.0 {
            continue;
        }
        let scores = subtask_scores(counted.details)
            .filter(|scores| !scores.is_empty())
            .unwrap_or_else(|| vec![(SINGLE_SUBTASK, counted.score)]);
        for (index, score) in scores {
            let best_for_subtask = best.entry(index).or_insert(0.0);
            *best_for_subtask = best_for_subtask.max(score);
        }
    }

    best.values().sum()
}

/// The maximum of the best tokened submission and the last submission: IOI 2010-2012.
///
/// # Panics
///
/// Panics on an empty slice: the mode's answer *is* the last submission, and the aggregation
/// returns before asking about a participation that sent none.
#[must_use]
pub fn max_tokened_last(contributions: &[Contribution<'_>]) -> f64 {
    let last = contributions
        .last()
        .expect("a participation whose score is asked has a submission")
        .counted
        .map_or(0.0, |counted| counted.score);

    let best_tokened = contributions
        .iter()
        .filter(|contribution| contribution.tokened)
        .filter_map(|contribution| contribution.counted)
        .map(|counted| counted.score)
        .fold(0.0, f64::max);

    last.max(best_tokened)
}

/// Whether the document holds no entry at all, which is what a failed compilation leaves.
fn document_is_empty(details: &ScoreDetails) -> bool {
    match details {
        ScoreDetails::Subtasks(subtasks) => subtasks.is_empty(),
        ScoreDetails::Testcases(rows) => rows.is_empty(),
    }
}

/// The per-subtask scores a document holds, or `None` for a document holding none.
///
/// Only a group document has subtasks. A contestant's document leaves the weighting off a
/// subtask it may not show, and the reference then reads that whole document as a single
/// subtask scored at the submission's score rather than as the part of it it can see.
fn subtask_scores(details: &ScoreDetails) -> Option<Vec<(usize, f64)>> {
    let ScoreDetails::Subtasks(subtasks) = details else {
        return None;
    };
    let mut scores = Vec::with_capacity(subtasks.len());
    for subtask in subtasks {
        let Subtask::Scored { index, score, .. } = subtask else {
            return None;
        };
        scores.push((*index, *score));
    }
    Some(scores)
}
