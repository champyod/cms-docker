//! One `submission_results` row: the columns that read it, and the record they
//! map onto.

use sqlx::{ColumnIndex, Decode, Error, FromRow, Row, Type};

use super::{DatasetId, SubmissionId};

/// The columns one `submission_results` row is read with, bound to its own ids as
/// `$1` and `$2`.
///
/// `r.compilation_outcome = 'ok'` is `NULL` rather than false on a row that has
/// never compiled, and the driver reads a `NULL` boolean as no value at all, so
/// the comparison is closed with `IS TRUE` and the record can hold a plain `bool`.
pub const RESULT_BY_SUBMISSION_AND_DATASET: &str = "\
    SELECT r.submission_id, r.dataset_id,
           r.compilation_outcome IS NOT NULL AS is_compiled,
           r.compilation_outcome = 'ok' IS TRUE AS is_compilation_succeeded,
           r.compilation_tries,
           r.evaluation_outcome IS NOT NULL AS is_evaluated,
           r.evaluation_tries
    FROM submission_results AS r
    WHERE r.submission_id = $1 AND r.dataset_id = $2";

/// One result: how far compilation and evaluation have got, and what they cost.
///
/// The fields are the aliases [`RESULT_BY_SUBMISSION_AND_DATASET`] projects, so
/// a row of that query binds straight onto this record.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ResultRecord {
    /// Which submission the row reports on, carried over from the pair the query
    /// read it by.
    pub submission_id: SubmissionId,
    /// `submission_results.dataset_id`, the dataset the result belongs to.
    pub dataset_id: DatasetId,
    /// `SubmissionResult.compiled()`: an outcome is recorded at all.
    pub is_compiled: bool,
    /// `SubmissionResult.compilation_succeeded()`: that outcome is `ok`.
    pub is_compilation_succeeded: bool,
    /// `submission_results.compilation_tries`, the failures so far.
    pub compilation_tries: i32,
    /// `SubmissionResult.evaluated()`: an outcome is recorded at all.
    pub is_evaluated: bool,
    /// `submission_results.evaluation_tries`, the failures so far.
    pub evaluation_tries: i32,
}

/// Maps the columns [`RESULT_BY_SUBMISSION_AND_DATASET`] names onto the record.
#[must_use]
pub const fn result_from_row(
    submission_id: SubmissionId,
    dataset_id: DatasetId,
    is_compiled: bool,
    is_compilation_succeeded: bool,
    compilation_tries: i32,
    is_evaluated: bool,
    evaluation_tries: i32,
) -> ResultRecord {
    ResultRecord {
        submission_id,
        dataset_id,
        is_compiled,
        is_compilation_succeeded,
        compilation_tries,
        is_evaluated,
        evaluation_tries,
    }
}

// The pair is read as the columns' own `integer` and wrapped, because a newtype the
// driver cannot decode is not a field type the derivation can reach.
impl<'r, R: Row> FromRow<'r, R> for ResultRecord
where
    for<'name> &'name str: ColumnIndex<R>,
    i32: Type<R::Database> + Decode<'r, R::Database>,
    bool: Type<R::Database> + Decode<'r, R::Database>,
{
    /// # Errors
    ///
    /// Returns the driver's own error for a column it could not read.
    fn from_row(row: &'r R) -> Result<Self, Error> {
        let submission_id: i32 = row.try_get("submission_id")?;
        let dataset_id: i32 = row.try_get("dataset_id")?;
        let is_compiled: bool = row.try_get("is_compiled")?;
        let is_compilation_succeeded: bool = row.try_get("is_compilation_succeeded")?;
        let compilation_tries: i32 = row.try_get("compilation_tries")?;
        let is_evaluated: bool = row.try_get("is_evaluated")?;
        let evaluation_tries: i32 = row.try_get("evaluation_tries")?;

        Ok(Self {
            submission_id: SubmissionId(submission_id),
            dataset_id: DatasetId(dataset_id),
            is_compiled,
            is_compilation_succeeded,
            compilation_tries,
            is_evaluated,
            evaluation_tries,
        })
    }
}
