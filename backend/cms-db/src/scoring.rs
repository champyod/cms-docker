//! The database boundary a scoring service uses to find work and persist scores.
//!
//! Candidate discovery mirrors the reference service's queue filter, while the
//! bundle read gathers the records the pure scoring core consumes from one
//! caller-owned transaction.

use sqlx::postgres::PgConnection;

use crate::reads::{testcases_by_dataset, DatasetId, DatasetRecord, SubmissionId, TestcaseRecord};
use crate::submission::{
    evaluations_by_result, result_by_id, Evaluation, Submission, SubmissionError, SubmissionResult,
};
use crate::task::{dataset_by_id, Task, TaskError};
use crate::writes::{ScoreRow, UPSERT_SCORE};

/// One submission result that is ready for a scoring pass.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScoringCandidate {
    /// The submission whose result needs scoring.
    pub submission_id: SubmissionId,
    /// The dataset whose score type judges that submission.
    pub dataset_id: DatasetId,
    /// The submission timestamp the reference queue carries for fairness.
    pub timestamp: chrono::NaiveDateTime,
}

/// The reference queue filter, with timestamp and id making its order deterministic.
const SCORING_CANDIDATES: &str = "\
    SELECT s.id AS submission_id, d.id AS dataset_id, s.timestamp
    FROM submissions AS s
    JOIN tasks AS t ON t.id = s.task_id
    JOIN submission_results AS r ON r.submission_id = s.id
    JOIN datasets AS d ON d.id = r.dataset_id
    WHERE (t.active_dataset_id = d.id OR d.autojudge)
      AND NOT (r.score IS NOT NULL AND r.score_details IS NOT NULL
               AND r.public_score IS NOT NULL AND r.public_score_details IS NOT NULL
               AND r.ranking_score_details IS NOT NULL)
      AND (r.compilation_outcome = 'fail' OR r.evaluation_outcome IS NOT NULL)
    ORDER BY s.timestamp, s.id";

/// Every judgeable, unscored result whose compilation failed or evaluation ended.
///
/// # Errors
///
/// Returns the driver's own error for a statement it could not run.
pub async fn scoring_candidates(
    connection: &mut PgConnection,
) -> Result<Vec<ScoringCandidate>, sqlx::Error> {
    let rows = sqlx::query_as::<_, CandidateRow>(SCORING_CANDIDATES)
        .fetch_all(connection)
        .await?;
    Ok(rows.into_iter().map(ScoringCandidate::from).collect())
}

/// The driver-facing candidate row before its two ids become distinct types.
#[derive(Debug, sqlx::FromRow)]
struct CandidateRow {
    submission_id: i32,
    dataset_id: i32,
    timestamp: chrono::NaiveDateTime,
}

impl From<CandidateRow> for ScoringCandidate {
    fn from(row: CandidateRow) -> Self {
        Self {
            submission_id: SubmissionId(row.submission_id),
            dataset_id: DatasetId(row.dataset_id),
            timestamp: row.timestamp,
        }
    }
}

/// The records the pure scoring core needs for one candidate.
#[derive(Debug, Clone, PartialEq)]
pub struct ScoringBundle {
    /// The task that publishes score precision.
    pub task: Task,
    /// The dataset that selects the score type and its parameters.
    pub dataset: DatasetRecord,
    /// The result whose compilation and evaluation state select the scoring path.
    pub result: SubmissionResult,
    /// Every testcase run recorded for the result.
    pub evaluations: Vec<Evaluation>,
    /// Every testcase belonging to the candidate's dataset.
    pub testcases: Vec<TestcaseRecord>,
}

/// Why one candidate's scoring records could not be read.
#[derive(Debug, thiserror::Error)]
pub enum ScoringReadError {
    /// A row the candidate named no longer exists.
    #[error("the scoring candidate no longer exists")]
    MissingCandidate,
    /// The candidate's submission could not be read.
    #[error(transparent)]
    Submission(#[from] SubmissionError),
    /// The submission's task could not be read.
    #[error(transparent)]
    Task(#[from] TaskError),
    /// A read the driver refused.
    #[error(transparent)]
    Database(#[from] sqlx::Error),
}

/// Read every record the pure scoring core needs for one candidate.
///
/// Pass a [`crate::Transaction`]'s connection so every read sees the same
/// snapshot; this function neither begins nor commits that transaction.
///
/// # Errors
///
/// Returns [`ScoringReadError::MissingCandidate`] when a named row disappeared,
/// the submission or task error when an existing row cannot be mapped, and
/// [`ScoringReadError::Database`] for any other refused read.
pub async fn read_result_bundle(
    connection: &mut PgConnection,
    candidate: &ScoringCandidate,
) -> Result<ScoringBundle, ScoringReadError> {
    let submission = Submission::get(connection, candidate.submission_id)
        .await?
        .ok_or(ScoringReadError::MissingCandidate)?;
    let task = Task::get(connection, submission.record.task_id)
        .await?
        .ok_or(ScoringReadError::MissingCandidate)?;
    let dataset = dataset_by_id(connection, candidate.dataset_id)
        .await?
        .ok_or(ScoringReadError::MissingCandidate)?;
    let result = result_by_id(connection, candidate.submission_id, candidate.dataset_id)
        .await?
        .ok_or(ScoringReadError::MissingCandidate)?;
    let evaluations =
        evaluations_by_result(connection, candidate.submission_id, candidate.dataset_id).await?;
    let testcases = testcases_by_dataset(connection, candidate.dataset_id).await?;
    Ok(ScoringBundle {
        task,
        dataset,
        result,
        evaluations,
        testcases,
    })
}

/// Write one score row, replacing every score column when its key already exists.
///
/// # Errors
///
/// Returns the driver's own error for a statement it could not run.
pub async fn write_score(connection: &mut PgConnection, row: &ScoreRow) -> Result<(), sqlx::Error> {
    sqlx::query(UPSERT_SCORE)
        .bind(row.submission_id.0)
        .bind(row.dataset_id.0)
        .bind(row.score)
        .bind(row.score_details.as_deref())
        .bind(row.scored_at)
        .bind(row.public_score)
        .bind(row.public_score_details.as_deref())
        .bind(row.ranking_score_details.as_deref())
        .execute(connection)
        .await?;
    Ok(())
}
