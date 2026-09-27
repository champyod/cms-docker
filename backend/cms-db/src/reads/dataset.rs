//! One `datasets` row: the columns that read it, and the record they map onto.

use sqlx::FromRow;

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

/// One dataset: the task it judges for, the limits it imposes, whether it is live.
///
/// The fields are the columns [`DATASET_BY_ID`] projects, so a row of that query
/// binds straight onto this record.
#[derive(Debug, Clone, PartialEq, FromRow)]
pub struct DatasetRecord {
    /// What the task's `active_dataset_id` is compared against, which is why the
    /// query joins `tasks` rather than reading the flag off this table.
    pub id: i32,
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
    id: i32,
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
