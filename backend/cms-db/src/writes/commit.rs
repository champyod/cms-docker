//! The commit that turns grouped object writes into rows, in one transaction.
//!
//! [`group_by_object`] decides which rows go down together and [`ObjectWrite::seal`]
//! refuses one that would be written unrecorded; the rest runs on one
//! [`sqlx::Transaction`] so a batch is all-or-nothing. The evaluation rows are
//! each written inside a savepoint: the reference's `begin_nested` swallows one
//! `IntegrityError` so a duplicate testcase cannot poison the whole batch.
//!
//! The completion rule reproduces `set_evaluation_outcome`: once the stored
//! evaluation count for a submission and dataset equals the dataset's testcase
//! count, the single enum value `ok` is stamped on the result row. Everything,
//! including that stamp and the audit appends, is committed once.

use sqlx::postgres::PgConnection;
use sqlx::Connection;

use super::batch::{group_by_object, AuditRow, ObjectWrite, OperationType, WriteError};
use super::shapes::{
    CompilationOutcome, EvaluationOutcome, EvaluationRow, ExecutableRow, ResultRow, ScoreRow,
};
use super::statements::{INSERT_EXECUTABLES, UPSERT_RESULT, UPSERT_SCORE};
use crate::reads::{DatasetId, SubmissionId};

/// The audit store's append-only event, one statement per row in the batch's
/// order; the hash chain the store keeps expects that sequential append order.
const INSERT_AUDIT: &str = "\
    INSERT INTO audit_log (actor_id, verb, entity, entity_id, reason, result) \
    VALUES ($1, $2, $3, $4, $5, $6)";

/// The stored evaluations of one submission on one dataset.
const COUNT_EVALUATIONS: &str = "\
    SELECT count(*) FROM evaluations WHERE submission_id = $1 AND dataset_id = $2";

/// The testcases a dataset declares.
const COUNT_TESTCASES: &str = "SELECT count(*) FROM testcases WHERE dataset_id = $1";

/// The one value `set_evaluation_outcome` ever assigns.
const SET_EVALUATION_OUTCOME: &str = "\
    UPDATE submission_results SET evaluation_outcome = 'ok' \
    WHERE submission_id = $1 AND dataset_id = $2";

/// A single savepoint name, released and recreated for each evaluation row.
const SAVEPOINT_SQL: &str = "SAVEPOINT sp_evaluation";
const RELEASE_SQL: &str = "RELEASE SAVEPOINT sp_evaluation";
const ROLLBACK_TO_SQL: &str = "ROLLBACK TO SAVEPOINT sp_evaluation";

/// Why a commit failed before or while it reached the database.
#[derive(Debug, thiserror::Error)]
pub enum CommitError {
    /// A batch carried no audit row, refused before any statement ran.
    #[error(transparent)]
    Write(#[from] WriteError),
    /// A statement or the transaction itself was refused by the driver.
    #[error(transparent)]
    Database(#[from] sqlx::Error),
}

/// Commit grouped object writes into rows in one transaction.
///
/// Each group is sealed, then its result, executables, evaluations, score and
/// audit rows are written in that order. For an [`OperationType::Evaluation`]
/// group, the completion rule stamps `evaluation_outcome = 'ok'` when the stored
/// evaluation count equals the dataset's testcase count. One duplicate
/// evaluation row is tolerated per row without losing the others.
///
/// # Errors
///
/// Returns [`CommitError::Write`] when a group is unsealed, or
/// [`CommitError::Database`] when a statement or the transaction fails.
pub async fn commit(
    connection: &mut PgConnection,
    writes: &[ObjectWrite],
) -> Result<(), CommitError> {
    let groups = group_by_object(writes)?;
    let sealed: Vec<ObjectWrite> = groups
        .into_iter()
        .map(ObjectWrite::seal)
        .collect::<Result<_, _>>()?;

    let mut transaction = connection.begin().await?;
    for group in &sealed {
        write_result(&mut transaction, &group.result).await?;
        if !group.executables.is_empty() {
            insert_executables(&mut transaction, &group.executables).await?;
        }
        write_evaluations(&mut transaction, &group.evaluations).await?;
        if let Some(score) = &group.score {
            upsert_score(&mut transaction, score).await?;
        }
        write_audit(&mut transaction, &group.audit).await?;
    }
    for group in &sealed {
        if group.operation == OperationType::Evaluation {
            apply_completion(&mut transaction, group.submission_id, group.dataset_id).await?;
        }
    }
    transaction.commit().await?;
    Ok(())
}

/// Upsert one object's result row.
async fn write_result(connection: &mut PgConnection, row: &ResultRow) -> Result<(), sqlx::Error> {
    sqlx::query(UPSERT_RESULT)
        .bind(row.submission_id.0)
        .bind(row.dataset_id.0)
        .bind(row.compilation_outcome.map(CompilationOutcome::as_str))
        .bind(row.compilation_text.clone())
        .bind(row.compilation_tries)
        .bind(row.compilation_stdout.as_deref())
        .bind(row.compilation_stderr.as_deref())
        .bind(row.compilation_time)
        .bind(row.compilation_wall_clock_time)
        .bind(row.compilation_memory)
        .bind(row.compilation_shard)
        .bind(row.compilation_sandbox_paths.clone())
        .bind(row.compilation_sandbox_digests.clone())
        .bind(row.evaluation_outcome.map(EvaluationOutcome::as_str))
        .bind(row.evaluation_tries)
        .execute(&mut *connection)
        .await?;
    Ok(())
}

/// Insert one compilation's executable set when it is non-empty.
async fn insert_executables(
    connection: &mut PgConnection,
    rows: &[ExecutableRow],
) -> Result<(), sqlx::Error> {
    let mut submissions = Vec::with_capacity(rows.len());
    let mut datasets = Vec::with_capacity(rows.len());
    let mut filenames = Vec::with_capacity(rows.len());
    let mut digests = Vec::with_capacity(rows.len());
    for row in rows {
        submissions.push(row.submission_id.0);
        datasets.push(row.dataset_id.0);
        filenames.push(row.filename.clone());
        digests.push(row.digest.to_string());
    }
    sqlx::query(INSERT_EXECUTABLES)
        .bind(submissions)
        .bind(datasets)
        .bind(filenames)
        .bind(digests)
        .execute(&mut *connection)
        .await?;
    Ok(())
}

/// Write each evaluation row in its own savepoint, swallowing a duplicate so
/// the other rows still land; the reference does the same with `begin_nested`.
async fn write_evaluations(
    connection: &mut PgConnection,
    rows: &[EvaluationRow],
) -> Result<(), sqlx::Error> {
    for row in rows {
        sqlx::query(SAVEPOINT_SQL).execute(&mut *connection).await?;
        match ObjectWrite::write_evaluations(connection, std::slice::from_ref(row)).await {
            Ok(()) => {
                sqlx::query(RELEASE_SQL).execute(&mut *connection).await?;
            }
            Err(_) => {
                // WHY a duplicate must not poison the batch: roll back only this row.
                sqlx::query(ROLLBACK_TO_SQL)
                    .execute(&mut *connection)
                    .await?;
                sqlx::query(RELEASE_SQL).execute(&mut *connection).await?;
            }
        }
    }
    Ok(())
}

/// Upsert the score fields one scoring pass filled in.
async fn upsert_score(connection: &mut PgConnection, row: &ScoreRow) -> Result<(), sqlx::Error> {
    sqlx::query(UPSERT_SCORE)
        .bind(row.submission_id.0)
        .bind(row.dataset_id.0)
        .bind(row.score)
        .bind(row.score_details.as_deref())
        .bind(row.scored_at)
        .bind(row.public_score)
        .bind(row.public_score_details.as_deref())
        .bind(row.ranking_score_details.clone())
        .execute(&mut *connection)
        .await?;
    Ok(())
}

/// Append the audit rows one statement each, in the batch's order.
///
/// The store's `AuditEntry` hash chain requires sequential appends, and its
/// `insert_entry` helper writes exactly one row, so no bulk insert is used.
async fn write_audit(connection: &mut PgConnection, audit: &[AuditRow]) -> Result<(), sqlx::Error> {
    for row in audit {
        sqlx::query(INSERT_AUDIT)
            .bind(row.actor_id)
            .bind(row.verb.as_str())
            .bind(row.entity.as_str())
            .bind(row.entity_id.as_str())
            .bind(row.reason.as_str())
            .bind("ok")
            .execute(&mut *connection)
            .await?;
    }
    Ok(())
}

/// Stamp `evaluation_outcome = 'ok'` once every testcase has a stored row.
async fn apply_completion(
    connection: &mut PgConnection,
    submission: SubmissionId,
    dataset: DatasetId,
) -> Result<(), sqlx::Error> {
    let evaluations: i64 = sqlx::query_scalar(COUNT_EVALUATIONS)
        .bind(submission.0)
        .bind(dataset.0)
        .fetch_one(&mut *connection)
        .await?;
    let testcases: i64 = sqlx::query_scalar(COUNT_TESTCASES)
        .bind(dataset.0)
        .fetch_one(&mut *connection)
        .await?;
    if evaluations == testcases {
        sqlx::query(SET_EVALUATION_OUTCOME)
            .bind(submission.0)
            .bind(dataset.0)
            .execute(&mut *connection)
            .await?;
    }
    Ok(())
}
