//! One `submissions` row: the columns that read it, and the record they map onto.

use chrono::NaiveDateTime;

/// The columns one `submissions` row is read with, bound to its own id as `$1`.
pub const SUBMISSION_BY_ID: &str = "\
    SELECT s.id, s.task_id, s.participation_id, s.timestamp, s.language, s.official
    FROM submissions AS s
    WHERE s.id = $1";

/// A submission as judging holds it: which task, which contestant, and when.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubmissionRecord {
    /// `submissions.id`.
    pub id: i32,
    /// `submissions.task_id`, the task the submission is on.
    pub task_id: i32,
    /// `submissions.participation_id`, the contestant who sent it.
    pub participation_id: i32,
    /// `submissions.timestamp`, a time without a zone as the column stores it.
    pub timestamp: NaiveDateTime,
    /// `submissions.language`, absent when the task takes no language.
    pub language: Option<String>,
    /// `submissions.official`, false when the row is left out of the score.
    pub official: bool,
}

/// Maps the columns [`SUBMISSION_BY_ID`] names onto the record.
#[must_use]
pub const fn submission_from_row(
    id: i32,
    task_id: i32,
    participation_id: i32,
    timestamp: NaiveDateTime,
    language: Option<String>,
    official: bool,
) -> SubmissionRecord {
    SubmissionRecord {
        id,
        task_id,
        participation_id,
        timestamp,
        language,
        official,
    }
}
