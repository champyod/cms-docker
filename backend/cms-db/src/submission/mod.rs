//! The `submissions` row, the token it may carry, and the result it is judged into.
//!
//! `src/cms/db/submission.py:45-208`: a submission is one contestant's attempt at one
//! task, it carries at most one token, and its results are keyed by (submission,
//! dataset) so a rejudge on a new dataset adds a row rather than moving one.

use sqlx::postgres::PgConnection;

use crate::base::{Column, ColumnKind, Declaration};
use crate::reads::{submission_from_row, DatasetId, DatasetRecord, SubmissionId, SubmissionRecord};
use crate::task::{Task, TaskError};

mod evaluation;
mod result;
mod token;

pub use evaluation::{
    max_resources, Evaluation, DELETE_EVALUATIONS, DELETE_EXECUTABLES, EVALUATION,
    EVALUATIONS_BY_RESULT, EVALUATION_BY_TESTCASE,
};
pub use result::{result_by_id, SubmissionResult, SubmissionStatus};
pub use token::{
    accept_token, token_of, Token, TokenBudget, TokenRefusal, INSERT_TOKEN, TOKEN,
    TOKEN_BY_SUBMISSION, TOKEN_HISTORY,
};

/// The `submissions` table (`src/cms/db/submission.py:49-137`).
pub const SUBMISSION: Declaration = Declaration {
    table: "submissions",
    columns: &[
        Column::key("id", ColumnKind::Integer),
        Column::required("opaque_id", ColumnKind::BigInteger),
        Column::reference("participation_id", ColumnKind::Integer),
        Column::reference("task_id", ColumnKind::Integer),
        Column::required("timestamp", ColumnKind::Timestamp),
        Column::optional("language", ColumnKind::Text),
        Column::generated("comment", ColumnKind::Text),
        Column::generated("official", ColumnKind::Boolean),
    ],
    relationships: &["participation", "task", "files", "token", "results"],
};

/// The columns one `submissions` row is read with, bound to its own id as `$1`.
///
/// The six judging columns are the ones [`crate::SUBMISSION_BY_ID`] already projects,
/// so both queries name them and both map through the same field order.
pub const SUBMISSION_JUDGING_BY_ID: &str = "\
    SELECT s.id, s.opaque_id, s.task_id, s.participation_id, s.timestamp,
           s.language, s.comment, s.official
    FROM submissions AS s
    WHERE s.id = $1";

/// One submission: the judging columns, the opaque handle, and the panel's comment.
#[derive(Debug, Clone, PartialEq)]
pub struct Submission {
    /// `id`, `task_id`, `participation_id`, `timestamp`, `language` and `official`,
    /// read by the mapping the judging reads already use.
    pub record: SubmissionRecord,
    /// `submissions.opaque_id`, unique within the participation that sent it.
    pub opaque_id: i64,
    /// `submissions.comment`, whose first line is all the panel shows in a table.
    pub comment: String,
}

impl Submission {
    /// One submission by id, or `None` when the table holds no such row.
    ///
    /// # Errors
    ///
    /// Returns [`SubmissionError::Database`] for a row the driver refused.
    pub async fn get(
        connection: &mut PgConnection,
        id: SubmissionId,
    ) -> Result<Option<Self>, SubmissionError> {
        let row = sqlx::query_as::<_, SubmissionRow>(SUBMISSION_JUDGING_BY_ID)
            .bind(id.0)
            .fetch_optional(connection)
            .await?;
        let Some(row) = row else {
            return Ok(None);
        };
        Ok(Some(Self {
            record: submission_from_row(
                SubmissionId(row.id),
                row.task_id,
                row.participation_id,
                row.timestamp,
                row.language,
                row.official,
            ),
            opaque_id: row.opaque_id,
            comment: row.comment,
        }))
    }

    /// The first line of the comment, which is what a table row has space for.
    #[must_use]
    pub fn short_comment(&self) -> &str {
        self.comment.split('\n').next().unwrap_or_default()
    }

    /// The token played on this submission, if any.
    ///
    /// # Errors
    ///
    /// Returns [`SubmissionError::Database`] for a row the driver refused.
    pub async fn token(
        &self,
        connection: &mut PgConnection,
    ) -> Result<Option<Token>, SubmissionError> {
        Ok(token_of(connection, self.record.id).await?)
    }

    /// Whether the contestant played a token against this submission.
    ///
    /// # Errors
    ///
    /// Returns [`SubmissionError::Database`] for a row the driver refused.
    pub async fn tokened(&self, connection: &mut PgConnection) -> Result<bool, SubmissionError> {
        Ok(self.token(connection).await?.is_some())
    }

    /// This submission's result on `dataset`, or on the task's active one when absent.
    ///
    /// A dataset from another task is refused here rather than read as a mismatch
    /// the composite key would have refused (`submission.py:150-158`).
    ///
    /// # Errors
    ///
    /// Returns [`SubmissionError::DatasetOfAnotherTask`] for a dataset of another
    /// task, [`SubmissionError::Task`] when the task cannot be read, and
    /// [`SubmissionError::Database`] otherwise.
    pub async fn get_result(
        &self,
        connection: &mut PgConnection,
        dataset: Option<&DatasetRecord>,
    ) -> Result<Option<SubmissionResult>, SubmissionError> {
        let dataset_id = match dataset {
            Some(dataset) => {
                if dataset.task_id != self.record.task_id {
                    return Err(SubmissionError::DatasetOfAnotherTask {
                        dataset: dataset.id,
                        task: self.record.task_id,
                    });
                }
                dataset.id
            }
            None => match self.active_dataset(connection).await? {
                Some(dataset) => dataset,
                None => return Ok(None),
            },
        };
        Ok(result_by_id(connection, self.record.id, dataset_id).await?)
    }

    /// The result on `dataset`, or a fresh one that reads as still compiling.
    ///
    /// The reference returns an unsaved row for the pair (`submission.py:160-180`) and
    /// lets the caller write it; this does the same, so a rejudge is an upsert of what
    /// comes back rather than a second read after an insert nobody made.
    ///
    /// # Errors
    ///
    /// Returns the same refusals as [`Submission::get_result`], and
    /// [`SubmissionError::NoActiveDataset`] when neither a dataset nor an active one holds.
    pub async fn get_result_or_create(
        &self,
        connection: &mut PgConnection,
        dataset: Option<&DatasetRecord>,
    ) -> Result<SubmissionResult, SubmissionError> {
        if let Some(found) = self.get_result(connection, dataset).await? {
            return Ok(found);
        }
        let dataset_id =
            match dataset {
                Some(dataset) => dataset.id,
                None => self.active_dataset(connection).await?.ok_or(
                    SubmissionError::NoActiveDataset {
                        task: self.record.task_id,
                    },
                )?,
            };
        Ok(SubmissionResult::new(self.record.id, dataset_id))
    }

    /// The active dataset of this submission's task, which the reference reads as `task.active_dataset`.
    async fn active_dataset(
        &self,
        connection: &mut PgConnection,
    ) -> Result<Option<DatasetId>, SubmissionError> {
        Ok(Task::get(connection, self.record.task_id)
            .await?
            .and_then(|task| task.active_dataset_id))
    }
}

/// The driver-facing shape of a `submissions` row.
#[derive(Debug, sqlx::FromRow)]
struct SubmissionRow {
    id: i32,
    opaque_id: i64,
    task_id: i32,
    participation_id: i32,
    timestamp: chrono::NaiveDateTime,
    language: Option<String>,
    comment: String,
    official: bool,
}

/// Why a submission could not be read, judged, or made to play a token.
#[derive(Debug, thiserror::Error)]
pub enum SubmissionError {
    /// The dataset named judges another task.
    #[error("dataset {dataset} does not judge task {task}")]
    DatasetOfAnotherTask {
        /// The dataset the caller named.
        dataset: DatasetId,
        /// The submission's task.
        task: i32,
    },
    /// The testcase named belongs to another dataset than the result's.
    #[error("testcase {testcase} is not one of the testcases of dataset {dataset}")]
    TestcaseOfAnotherDataset {
        /// The testcase the caller named.
        testcase: i32,
        /// The result's dataset.
        dataset: DatasetId,
    },
    /// The submission has no active dataset to be judged against.
    #[error("task {task} has no active dataset")]
    NoActiveDataset {
        /// The task whose pointer is NULL.
        task: i32,
    },
    /// The play the caller asked for was refused.
    #[error(transparent)]
    Refused(#[from] TokenRefusal),
    /// The task the submission is on could not be read.
    #[error(transparent)]
    Task(#[from] TaskError),
    /// A read or a write the driver refused.
    #[error(transparent)]
    Database(#[from] sqlx::Error),
}
