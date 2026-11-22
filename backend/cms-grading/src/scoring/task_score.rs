//! The score a participation is ranked on: which submissions count, and what is still pending.
//!
//! `scoring.py:106`. A participation's submissions in the task are read in timestamp order —
//! the tokened-last mode's answer *is* the last one, so the order is part of the arithmetic,
//! not a presentation detail — and each becomes a [`Contribution`]: the score and document the
//! caller asked for, or nothing for a row the mode must not see.
//!
//! Two things are refused rather than passed on. A public score restricted to tokened
//! submissions is a programming error in the reference and stays one here: a token hides a
//! score the contestant has not bought, and a public score is never hidden, so no caller can
//! mean the pair. And the score mode is [`ScoreMode`], a closed enum, so the reference's
//! `Unknown score mode` branch has nowhere to land.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use cms_db::ScoreMode;

use crate::scoretypes::round_at;

use super::modes::{max, max_subtask, max_tokened_last};
use super::participation::{Contribution, ResultColumns, Submission};
use super::{ScoreOptions, TaskSettings};

/// What the reference raises when asked for a public score of tokened submissions only.
const PUBLIC_TOKENED: &str = "Requested public task score restricted to tokened submissions. \
     This is a programming error: users have access to all public scores regardless of token status.";

/// A participation's score on a task, and whether any of its submissions is still unscored.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TaskScore {
    /// The task's score mode applied to the submissions that count.
    pub score: f64,
    /// Whether an official submission has a result with a null column. This is about the
    /// participation, not about the score: it says something may still move, not that the
    /// answer is provisional or wrong.
    pub is_pending: bool,
}

/// One participation's score on one task.
///
/// `submissions` are the participation's submissions in the task, official or not: the
/// non-official ones are dropped here, as the reference drops them, so a caller cannot forget
/// to and count a practice submission in a ranking.
///
/// # Panics
///
/// Panics when `options.public` and `options.only_tokened` are both set, with the reference's
/// own message: the pair asks for a score hidden by a token the contestant can already see.
#[must_use]
pub fn task_score(
    submissions: &[Submission<'_>],
    task: TaskSettings,
    options: ScoreOptions,
) -> TaskScore {
    assert!(
        !(options.public && options.only_tokened),
        "{PUBLIC_TOKENED}"
    );

    let mut official: Vec<&Submission<'_>> = submissions
        .iter()
        .filter(|submission| submission.official)
        .collect();
    if official.is_empty() {
        return TaskScore {
            score: 0.0,
            is_pending: false,
        };
    }
    // WHY: the last submission decides this mode, so a stable sort keeps ties in caller order.
    official.sort_by_key(|submission| submission.submitted_at);

    let mut contributions = Vec::with_capacity(official.len());
    let mut is_pending = false;
    for submission in official {
        let counted = match (submission.result, submission.tokened) {
            // WHY: a null column is a result the queue has not scored, which is what `is_pending` reports.
            (ResultColumns::Unscored, _) => {
                is_pending = true;
                None
            }
            // WHY: a token bought this score; leaving it out is not the same as it being unscored.
            (_, false) if options.only_tokened => None,
            (scored, _) => scored.counted(options.public),
        };
        contributions.push(Contribution {
            counted,
            tokened: submission.tokened,
        });
    }

    let score = match task.score_mode {
        ScoreMode::Max => max(&contributions),
        ScoreMode::MaxSubtask => max_subtask(&contributions),
        ScoreMode::MaxTokenedLast => max_tokened_last(&contributions),
    };
    let score = if options.rounded {
        round_at(score, task.score_precision)
    } else {
        score
    };

    TaskScore { score, is_pending }
}
