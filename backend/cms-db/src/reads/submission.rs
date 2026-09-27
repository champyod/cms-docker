//! One `submissions` row: the columns that read it, and the record they map onto.

use std::fmt;

use chrono::NaiveDateTime;
use sqlx::{ColumnIndex, Decode, Error, FromRow, Row, Type};

/// The columns one `submissions` row is read with, bound to its own id as `$1`.
pub const SUBMISSION_BY_ID: &str = "\
    SELECT s.id, s.task_id, s.participation_id, s.timestamp, s.language, s.official
    FROM submissions AS s
    WHERE s.id = $1";

/// A `submissions.id`.
///
/// A submission id and a dataset id are both `integer` columns and every result
/// is filed under the pair of them, so a bare `i32` on either half compiles and
/// files the row under the other object.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct SubmissionId(pub i32);

impl fmt::Display for SubmissionId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

/// A submission as judging holds it: which task, which contestant, and when.
///
/// The fields are the columns [`SUBMISSION_BY_ID`] projects, so a row of that
/// query binds straight onto this record.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubmissionRecord {
    /// The handle every result is filed under, so one submission is tracked
    /// across every dataset it was judged on and every rejudge it survives.
    pub id: SubmissionId,
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
    id: SubmissionId,
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

// The id is read as the column's own `integer` and wrapped, because a newtype the
// driver cannot decode is not a field type the derivation can reach.
impl<'r, R: Row> FromRow<'r, R> for SubmissionRecord
where
    for<'name> &'name str: ColumnIndex<R>,
    i32: Type<R::Database> + Decode<'r, R::Database>,
    NaiveDateTime: Type<R::Database> + Decode<'r, R::Database>,
    String: Type<R::Database> + Decode<'r, R::Database>,
    bool: Type<R::Database> + Decode<'r, R::Database>,
{
    /// # Errors
    ///
    /// Returns the driver's own error for a column it could not read.
    fn from_row(row: &'r R) -> Result<Self, Error> {
        let id: i32 = row.try_get("id")?;
        let task_id: i32 = row.try_get("task_id")?;
        let participation_id: i32 = row.try_get("participation_id")?;
        let timestamp: NaiveDateTime = row.try_get("timestamp")?;
        let language: Option<String> = row.try_get("language")?;
        let official: bool = row.try_get("official")?;

        Ok(Self {
            id: SubmissionId(id),
            task_id,
            participation_id,
            timestamp,
            language,
            official,
        })
    }
}
