//! Activating and deleting a dataset, and what each of them leaves behind.
//!
//! Activation moves `tasks.active_dataset_id` and nothing else: the results filed
//! under the old dataset keep pointing at it, and only a submission's *next*
//! `get_result` sees the new one (`dataset.py:283-295`). Deletion is the other
//! direction — the composite key cascades the dataset's results away and sets the
//! task's pointer to NULL (`task.py:57-67`, `submission.py:311-315`).

use sqlx::postgres::PgConnection;

use super::{Task, TaskError};
use crate::reads::{
    DatasetId, DatasetRecord, SubmissionId, TestcaseRecord, DATASET_BY_ID, TESTCASES_BY_DATASET,
};

/// Moves a task's active pointer, bound as the task's id then the dataset's id.
pub const ACTIVATE_DATASET: &str = "UPDATE tasks SET active_dataset_id = $2 WHERE id = $1";

/// Removes a dataset, bound to its own id: the results filed under it cascade away.
pub const DELETE_DATASET: &str = "DELETE FROM datasets WHERE id = $1";

/// The submissions of a task with no result for a dataset, bound as the task's id then the dataset's id.
///
/// The outer join says it more plainly than a set difference: a submission is
/// listed exactly when no `submission_results` row pairs it with that dataset.
pub const SUBMISSIONS_WITHOUT_RESULT: &str = "\
    SELECT s.id
    FROM submissions AS s
    WHERE s.task_id = $1
      AND NOT EXISTS (SELECT 1 FROM submission_results AS r
                      WHERE r.submission_id = s.id AND r.dataset_id = $2)
    ORDER BY s.id";

impl Task {
    /// The dataset currently scored, or `None` when none is active.
    ///
    /// # Errors
    ///
    /// Returns [`TaskError::Database`] for a row the driver refused.
    pub async fn active_dataset(
        &self,
        connection: &mut PgConnection,
    ) -> Result<Option<DatasetRecord>, TaskError> {
        let Some(dataset) = self.active_dataset_id else {
            return Ok(None);
        };
        Ok(dataset_by_id(connection, dataset).await?)
    }

    /// The testcases of the active dataset, the set the reference reads as `Dataset.testcases`.
    ///
    /// Empty when no dataset is active: `task.py:239-245` keeps the pointer the only
    /// entry, so there is no set to fall back to.
    ///
    /// # Errors
    ///
    /// Returns [`TaskError::Database`] for a row the driver refused, which carries
    /// [`crate::ReadError::Digest`] when a `DIGEST` column holds a refused value.
    pub async fn testcases(
        &self,
        connection: &mut PgConnection,
    ) -> Result<Vec<TestcaseRecord>, TaskError> {
        let Some(dataset) = self.active_dataset_id else {
            return Ok(Vec::new());
        };
        Ok(sqlx::query_as::<_, TestcaseRecord>(TESTCASES_BY_DATASET)
            .bind(dataset.0)
            .fetch_all(connection)
            .await?)
    }
}

/// One dataset by id, or `None` when the table holds no such row.
///
/// # Errors
///
/// Returns the driver's own error for a row it could not read.
pub async fn dataset_by_id(
    connection: &mut PgConnection,
    dataset: DatasetId,
) -> Result<Option<DatasetRecord>, sqlx::Error> {
    sqlx::query_as::<_, DatasetRecord>(DATASET_BY_ID)
        .bind(dataset.0)
        .fetch_optional(connection)
        .await
}

/// Points `task_id` at `dataset`, refusing a dataset the task does not own.
///
/// # Errors
///
/// Returns [`TaskError::DatasetOfAnotherTask`] when the pair the reference's
/// composite key requires does not hold, and [`TaskError::Database`] otherwise.
pub async fn activate_dataset(
    connection: &mut PgConnection,
    task_id: i32,
    dataset: DatasetId,
) -> Result<(), TaskError> {
    let found =
        dataset_by_id(connection, dataset)
            .await?
            .ok_or(TaskError::DatasetOfAnotherTask {
                dataset,
                task: task_id,
            })?;
    if found.task_id != task_id {
        return Err(TaskError::DatasetOfAnotherTask {
            dataset,
            task: task_id,
        });
    }
    sqlx::query(ACTIVATE_DATASET)
        .bind(task_id)
        .bind(dataset.0)
        .execute(connection)
        .await?;
    Ok(())
}

/// The submissions of `task_id` with no result for `dataset`: what activation re-queues.
///
/// `submission_to_compile(None)` is true (`esoperations.py:87-95`), and a dataset
/// marked `autojudge` is judged beside the active one, so this list is one dataset's.
///
/// # Errors
///
/// Returns [`TaskError::Database`] for a query the driver refused.
pub async fn unjudged_submissions(
    connection: &mut PgConnection,
    task_id: i32,
    dataset: DatasetId,
) -> Result<Vec<SubmissionId>, TaskError> {
    let rows: Vec<i32> = sqlx::query_scalar(SUBMISSIONS_WITHOUT_RESULT)
        .bind(task_id)
        .bind(dataset.0)
        .fetch_all(connection)
        .await?;
    Ok(rows.into_iter().map(SubmissionId).collect())
}

/// Removes `dataset`, cascading its results and nulling the pointer that named it.
///
/// # Errors
///
/// Returns [`TaskError::Database`] for a delete the driver refused.
pub async fn delete_dataset(
    connection: &mut PgConnection,
    dataset: DatasetId,
) -> Result<u64, TaskError> {
    let done = sqlx::query(DELETE_DATASET)
        .bind(dataset.0)
        .execute(connection)
        .await?;
    Ok(done.rows_affected())
}
