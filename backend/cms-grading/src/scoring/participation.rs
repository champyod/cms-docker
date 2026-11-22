//! The values one participation's submissions are handed in as.
//!
//! A submission here is not a row: it is the timestamp it was sent at, whether it was
//! official, whether a token was played on it, and the five score columns of its result for
//! the dataset being ranked. That is why the ranking arithmetic can be exercised without a
//! database — a caller that read the rows builds these, and nothing below looks anything up.
//!
//! The columns are an enum rather than five optional fields because the reference's
//! `scored()` asks one question of all five at once: `Scored` is only reachable when every
//! one of them is filled, so a row still missing its ranking details cannot be aggregated as
//! if it were half scored.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use crate::scoretypes::ScoreDetails;

/// When a submission was sent: `submissions.timestamp` in microseconds since the epoch.
///
/// Only the order matters, and only [`crate::scoring::max_tokened_last`] depends on it, but
/// an integer keeps that order exact where the column's own resolution does.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct SubmittedAt(pub i64);

/// The score columns of one `submission_results` row, for the dataset being ranked.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ResultColumns<'a> {
    /// At least one of the five columns is null, which the reference reads as not scored.
    Unscored,
    /// Scored: every column the reference's `scored()` tests is filled.
    Scored {
        /// `submission_results.score`.
        score: f64,
        /// `submission_results.score_details`, the document an administrator's page reads.
        details: &'a ScoreDetails,
        /// `submission_results.public_score`, the score over the public testcases alone.
        public_score: f64,
        /// `submission_results.public_score_details`, the document a contestant's page reads.
        public_details: &'a ScoreDetails,
    },
}

impl<'a> ResultColumns<'a> {
    /// The score and document `public` selects, absent when this row is not scored.
    ///
    /// The two pairs are different columns rather than one number shown twice: the public
    /// score is what a contestant may see without a token, not the full score rounded.
    #[must_use]
    pub fn counted(self, public: bool) -> Option<Counted<'a>> {
        match self {
            Self::Unscored => None,
            Self::Scored {
                public_score,
                public_details,
                ..
            } if public => Some(Counted {
                score: public_score,
                details: public_details,
            }),
            Self::Scored { score, details, .. } => Some(Counted { score, details }),
        }
    }
}

/// A submission the aggregation counts, with the document behind its score.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Counted<'a> {
    /// The score, before the task's precision is applied.
    pub score: f64,
    /// The document behind it, which only the subtask mode reads.
    pub details: &'a ScoreDetails,
}

/// One submission of a participation in the task, as the aggregation reads it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Submission<'a> {
    /// `submissions.timestamp`: the order the score modes read submissions in.
    pub submitted_at: SubmittedAt,
    /// `Submission.tokened()`: the contestant played a token on it.
    pub tokened: bool,
    /// `submissions.official`: a false row is left out of the score entirely.
    pub official: bool,
    /// The result for the dataset being ranked.
    pub result: ResultColumns<'a>,
}

/// One submission as a score mode sees it.
///
/// The mode is handed the same two things the reference hands it — a score and its details,
/// or nothing, and whether the submission was tokened — so what a mode decides is what it is
/// given, never what it could go and read.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Contribution<'a> {
    /// Absent for a submission this mode must not see, which is a submission the reference
    /// passes over as if it were not scored.
    pub counted: Option<Counted<'a>>,
    /// `Submission.tokened()`.
    pub tokened: bool,
}
