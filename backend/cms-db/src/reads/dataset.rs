//! One `datasets` row: the columns that read it, and the record they map onto.

use std::fmt;

use sqlx::{ColumnIndex, Decode, Error, FromRow, Row, Type};

/// The columns one `datasets` row is read with, bound to its own id as `$1`.
///
/// `tasks.active_dataset_id` is nullable and `=` against it is `NULL` rather than
/// false, so the flag is spelled `IS NOT DISTINCT FROM` to give the false
/// `Dataset.active` returns for a task with no active dataset.
pub const DATASET_BY_ID: &str = "\
    SELECT d.id, d.task_id, d.task_type, d.time_limit, d.memory_limit,
           t.active_dataset_id IS NOT DISTINCT FROM d.id AS is_active
    FROM datasets AS d
    JOIN tasks AS t ON t.id = d.task_id
    WHERE d.id = $1";

/// A `datasets.id`.
///
/// A dataset id and a submission id are both `integer` columns and every result
/// is filed under the pair of them, so a bare `i32` on either half compiles and
/// files the row under the other object.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct DatasetId(pub i32);

impl fmt::Display for DatasetId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

/// One dataset: the task it judges for, the limits it imposes, whether it is live.
///
/// The fields are the columns [`DATASET_BY_ID`] projects, so a row of that query
/// binds straight onto this record.
#[derive(Debug, Clone, PartialEq)]
pub struct DatasetRecord {
    /// What the task's `active_dataset_id` is compared against, which is why the
    /// query joins `tasks` rather than reading the flag off this table.
    pub id: DatasetId,
    /// `datasets.task_id`, the task owning the dataset.
    pub task_id: i32,
    /// `datasets.task_type`, the name of the `TaskType` that judges it.
    pub task_type: String,
    /// `datasets.time_limit`, in seconds, absent when the dataset sets none.
    pub time_limit: Option<f64>,
    /// `datasets.memory_limit`, in bytes, absent when the dataset sets none.
    pub memory_limit: Option<i64>,
    /// `Dataset.active`: the dataset its own task points at.
    pub is_active: bool,
}

/// Maps the columns [`DATASET_BY_ID`] names onto the record.
#[must_use]
pub const fn dataset_from_row(
    id: DatasetId,
    task_id: i32,
    task_type: String,
    time_limit: Option<f64>,
    memory_limit: Option<i64>,
    is_active: bool,
) -> DatasetRecord {
    DatasetRecord {
        id,
        task_id,
        task_type,
        time_limit,
        memory_limit,
        is_active,
    }
}

// The id is read as the column's own `integer` and wrapped, because a newtype the
// driver cannot decode is not a field type the derivation can reach.
impl<'r, R: Row> FromRow<'r, R> for DatasetRecord
where
    for<'name> &'name str: ColumnIndex<R>,
    i32: Type<R::Database> + Decode<'r, R::Database>,
    String: Type<R::Database> + Decode<'r, R::Database>,
    f64: Type<R::Database> + Decode<'r, R::Database>,
    i64: Type<R::Database> + Decode<'r, R::Database>,
    bool: Type<R::Database> + Decode<'r, R::Database>,
{
    /// # Errors
    ///
    /// Returns the driver's own error for a column it could not read.
    fn from_row(row: &'r R) -> Result<Self, Error> {
        let id: i32 = row.try_get("id")?;
        let task_id: i32 = row.try_get("task_id")?;
        let task_type: String = row.try_get("task_type")?;
        let time_limit: Option<f64> = row.try_get("time_limit")?;
        let memory_limit: Option<i64> = row.try_get("memory_limit")?;
        let is_active: bool = row.try_get("is_active")?;

        Ok(Self {
            id: DatasetId(id),
            task_id,
            task_type,
            time_limit,
            memory_limit,
            is_active,
        })
    }
}
