//! The `evaluations` row one testcase run leaves: `submission.py:603-615,697-799`.

use sqlx::postgres::PgConnection;

use super::{SubmissionError, SubmissionResult};
use crate::base::{ArrayItem, Column, ColumnKind, Declaration};
use crate::reads::TestcaseRecord;

/// The `evaluations` table (`src/cms/db/submission.py:702-794`).
pub const EVALUATION: Declaration = Declaration {
    table: "evaluations",
    columns: &[
        Column::key("id", ColumnKind::Integer),
        Column::reference("submission_id", ColumnKind::Integer),
        Column::reference("dataset_id", ColumnKind::Integer),
        Column::reference("testcase_id", ColumnKind::Integer),
        Column::optional("outcome", ColumnKind::Text),
        Column::generated("text", ColumnKind::Array(ArrayItem::Text)),
        Column::optional("admin_text", ColumnKind::Text),
        Column::optional("execution_time", ColumnKind::Float),
        Column::optional("execution_wall_clock_time", ColumnKind::Float),
        Column::optional("execution_memory", ColumnKind::BigInteger),
        Column::optional("evaluation_shard", ColumnKind::Integer),
        Column::optional(
            "evaluation_sandbox_paths",
            ColumnKind::Array(ArrayItem::Text),
        ),
        Column::optional(
            "evaluation_sandbox_digests",
            ColumnKind::Array(ArrayItem::Text),
        ),
    ],
    relationships: &["submission", "dataset", "submission_result", "testcase"],
};

/// The columns one result's evaluations are read with, bound to its key as `$1`, `$2`.
pub const EVALUATIONS_BY_RESULT: &str = "\
    SELECT id, submission_id, dataset_id, testcase_id, outcome, text, admin_text,
           execution_time, execution_wall_clock_time, execution_memory,
           evaluation_shard, evaluation_sandbox_paths, evaluation_sandbox_digests
    FROM evaluations
    WHERE submission_id = $1 AND dataset_id = $2
    ORDER BY testcase_id";

/// The columns the one evaluation on a testcase is read with: the unique triple is what makes it one row rather than a list.
pub const EVALUATION_BY_TESTCASE: &str = "\
    SELECT id, submission_id, dataset_id, testcase_id, outcome, text, admin_text,
           execution_time, execution_wall_clock_time, execution_memory,
           evaluation_shard, evaluation_sandbox_paths, evaluation_sandbox_digests
    FROM evaluations
    WHERE submission_id = $1 AND dataset_id = $2 AND testcase_id = $3";

/// Removes one result's evaluations, or only the one on `$3`, since the outcome and try count are cleared either way (`:609-615`).
pub const DELETE_EVALUATIONS: &str = "\
    DELETE FROM evaluations
    WHERE submission_id = $1 AND dataset_id = $2
      AND ($3::integer IS NULL OR testcase_id = $3)";

/// Removes the executables a compilation produced, which no evaluation may outlive.
pub const DELETE_EXECUTABLES: &str =
    "DELETE FROM executables WHERE submission_id = $1 AND dataset_id = $2";

/// One testcase run: the outcome the grader reported and what it cost.
#[derive(Debug, Clone, PartialEq, sqlx::FromRow)]
pub struct Evaluation {
    /// `evaluations.id`.
    pub id: i32,
    /// `evaluations.submission_id`, half the owning result's key.
    pub submission_id: i32,
    /// `evaluations.dataset_id`, the other half.
    pub dataset_id: i32,
    /// `evaluations.testcase_id`, the one testcase this run measured.
    pub testcase_id: i32,
    /// `evaluations.outcome`, the grader's own string, not the points awarded.
    pub outcome: Option<String>,
    /// `evaluations.text`, the localized grader output.
    pub text: Vec<String>,
    /// `evaluations.admin_text`, the admin-facing grader output.
    pub admin_text: Option<String>,
    /// `evaluations.execution_time`, in seconds.
    pub execution_time: Option<f64>,
    /// `evaluations.execution_wall_clock_time`, in seconds.
    pub execution_wall_clock_time: Option<f64>,
    /// `evaluations.execution_memory`, in bytes.
    pub execution_memory: Option<i64>,
    /// `evaluations.evaluation_shard`, the worker that ran it.
    pub evaluation_shard: Option<i32>,
    /// `evaluations.evaluation_sandbox_paths`, absent when the run left no trace.
    pub evaluation_sandbox_paths: Option<Vec<String>>,
    /// `evaluations.evaluation_sandbox_digests`, absent when the run left no trace.
    pub evaluation_sandbox_digests: Option<Vec<String>>,
}

impl SubmissionResult {
    /// This result's evaluation on `testcase`, or `None` when it never ran there.
    ///
    /// # Errors
    ///
    /// Returns [`SubmissionError::TestcaseOfAnotherDataset`] when the testcase
    /// cannot belong to this result, and [`SubmissionError::Database`] otherwise.
    pub async fn get_evaluation(
        &self,
        connection: &mut PgConnection,
        testcase: &TestcaseRecord,
    ) -> Result<Option<Evaluation>, SubmissionError> {
        if testcase.dataset_id != self.dataset_id.0 {
            return Err(SubmissionError::TestcaseOfAnotherDataset {
                testcase: testcase.id,
                dataset: self.dataset_id,
            });
        }
        Ok(sqlx::query_as::<_, Evaluation>(EVALUATION_BY_TESTCASE)
            .bind(self.submission_id.0)
            .bind(self.dataset_id.0)
            .bind(testcase.id)
            .fetch_optional(connection)
            .await?)
    }

    /// The largest time and memory any testcase used: before evaluation the set is partial, and its maximum is not a number the contest ran.
    ///
    /// # Errors
    ///
    /// Returns [`SubmissionError::Database`] for a query the driver refused.
    pub async fn get_max_evaluation_resources(
        &self,
        connection: &mut PgConnection,
    ) -> Result<(Option<f64>, Option<i64>), SubmissionError> {
        if !self.evaluated() {
            return Ok((None, None));
        }
        let rows = sqlx::query_as::<_, Evaluation>(EVALUATIONS_BY_RESULT)
            .bind(self.submission_id.0)
            .bind(self.dataset_id.0)
            .fetch_all(connection)
            .await?;
        Ok(max_resources(&rows))
    }
}

/// The largest time and memory in `rows`, keeping `None` where every row left one out.
#[must_use]
pub fn max_resources(rows: &[Evaluation]) -> (Option<f64>, Option<i64>) {
    let time = rows
        .iter()
        .filter_map(|row| row.execution_time)
        .reduce(f64::max);
    let memory = rows
        .iter()
        .filter_map(|row| row.execution_memory)
        .reduce(i64::max);
    (time, memory)
}
