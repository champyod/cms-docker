//! The submissions and documents the scoring tests are decided by.
//!
//! Every figure a test expects was produced by running the reference's `scoring.py` over the
//! same submissions, so the numbers are the reference's rather than one this port chose. The
//! documents carry a score and nothing else a mode reads: `max_tokened_last` and `max` never
//! look at a document at all, and `max_subtask` reads a subtask's `score`.

#![allow(dead_code)]

use cms_grading::scoretypes::{ScoreDetails, Subtask, SumRow};
use cms_grading::scoring::{Contribution, Counted, ResultColumns, Submission, SubmittedAt};

/// A scored subtask; the weight is its own score so the fixture is self-consistent.
pub fn subtask(index: usize, score: f64) -> Subtask {
    Subtask::Scored {
        index,
        score_fraction: 1.0,
        score,
        max_score: score,
        testcases: Vec::new(),
    }
}

/// A subtask of a contestant's document, whose weighting they are not shown.
pub fn hidden_subtask(index: usize) -> Subtask {
    Subtask::Unscored {
        index,
        testcases: Vec::new(),
    }
}

/// A group document holding `subtasks`.
pub fn group_document(subtasks: Vec<Subtask>) -> ScoreDetails {
    ScoreDetails::Subtasks(subtasks)
}

/// A `Sum` document, which has one entry per testcase and no subtask to take a maximum over.
pub fn sum_document() -> ScoreDetails {
    ScoreDetails::Testcases(vec![SumRow::Hidden {
        index: "0_0".to_owned(),
    }])
}

/// The document a submission that never compiled leaves behind.
pub fn empty_document() -> ScoreDetails {
    ScoreDetails::Testcases(Vec::new())
}

/// A contribution the mode counts.
pub fn counted(score: f64, details: &ScoreDetails, tokened: bool) -> Contribution<'_> {
    Contribution {
        counted: Some(Counted { score, details }),
        tokened,
    }
}

/// A contribution the mode does not count: a pending row, or one no token revealed.
pub fn pending(tokened: bool) -> Contribution<'static> {
    Contribution {
        counted: None,
        tokened,
    }
}

/// An official submission whose result is scored, at `at`.
pub fn submission<'a>(
    at: i64,
    score: f64,
    public_score: f64,
    details: &'a ScoreDetails,
) -> Submission<'a> {
    Submission {
        submitted_at: SubmittedAt(at),
        tokened: false,
        official: true,
        result: ResultColumns::Scored {
            score,
            details,
            public_score,
            public_details: details,
        },
    }
}

/// The same submission with a token played on it.
pub fn tokened<'a>(
    at: i64,
    score: f64,
    public_score: f64,
    details: &'a ScoreDetails,
) -> Submission<'a> {
    Submission {
        tokened: true,
        ..submission(at, score, public_score, details)
    }
}

/// An official submission whose result is not scored yet.
pub fn pending_submission(at: i64) -> Submission<'static> {
    Submission {
        submitted_at: SubmittedAt(at),
        tokened: false,
        official: true,
        result: ResultColumns::Unscored,
    }
}
