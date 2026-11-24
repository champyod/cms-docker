//! One `datasets` row: the columns that read it, and the record they map onto.

use std::fmt;

use sqlx::postgres::PgConnection;
use sqlx::{ColumnIndex, Decode, Error, FromRow, Row, Type};

use crate::task::Task;

/// The columns one `datasets` row is read with, bound to its own id as `$1`.
///
/// `tasks.active_dataset_id` is nullable and `=` against it is `NULL` rather than
/// false, so the flag is spelled `IS NOT DISTINCT FROM` to give the false
/// `Dataset.active` returns for a task with no active dataset.
pub const DATASET_BY_ID: &str = "\
    SELECT d.id, d.task_id, d.task_type, d.score_type,
           d.score_type_parameters::text AS score_type_parameters,
           d.time_limit, d.memory_limit,
           t.active_dataset_id IS NOT DISTINCT FROM d.id AS is_active
    FROM datasets AS d
    JOIN tasks AS t ON t.id = d.task_id
    WHERE d.id = $1";

/// Every dataset of one task that is either its active dataset or marked `autojudge`,
/// bound to the task's id as `$1`.
///
/// `t.active_dataset_id = d.id` is false rather than `NULL` here because the whole
/// comparison sits under `OR`, so a task with no active dataset still admits its
/// `autojudge` rows.
pub const JUDGEABLE_DATASETS: &str = "\
    SELECT d.id, d.task_id, d.task_type, d.score_type,
           d.score_type_parameters::text AS score_type_parameters,
           d.time_limit, d.memory_limit,
           t.active_dataset_id IS NOT DISTINCT FROM d.id AS is_active
    FROM datasets AS d
    JOIN tasks AS t ON t.id = d.task_id
    WHERE d.task_id = $1
      AND (t.active_dataset_id = d.id OR d.autojudge)";

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
    /// `datasets.score_type`, the name of the score type that scores it.
    pub score_type: String,
    /// `datasets.score_type_parameters`, carried as the raw `jsonb` text the query casts.
    pub score_type_parameters: String,
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
    score_type: String,
    score_type_parameters: String,
    limits: (Option<f64>, Option<i64>),
    is_active: bool,
) -> DatasetRecord {
    DatasetRecord {
        id,
        task_id,
        task_type,
        score_type,
        score_type_parameters,
        time_limit: limits.0,
        memory_limit: limits.1,
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
        let score_type: String = row.try_get("score_type")?;
        let score_type_parameters: String = row.try_get("score_type_parameters")?;
        let time_limit: Option<f64> = row.try_get("time_limit")?;
        let memory_limit: Option<i64> = row.try_get("memory_limit")?;
        let is_active: bool = row.try_get("is_active")?;

        Ok(Self {
            id: DatasetId(id),
            task_id,
            task_type,
            score_type,
            score_type_parameters,
            time_limit,
            memory_limit,
            is_active,
        })
    }
}

/// The datasets of `task` that a submission is judged on without an admin asking.
///
/// `Dataset.autojudge` is not carried on [`DatasetRecord`]: the rule is what decides
/// membership, so a caller never has to re-apply it to the rows it is handed.
///
/// # Errors
///
/// Returns the driver's own error for a statement it could not run.
pub async fn get_datasets_to_judge(
    connection: &mut PgConnection,
    task: &Task,
) -> Result<Vec<DatasetRecord>, sqlx::Error> {
    sqlx::query_as::<_, DatasetRecord>(JUDGEABLE_DATASETS)
        .bind(task.id)
        .fetch_all(connection)
        .await
}
