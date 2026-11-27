//! The commit that turns grouped object writes into rows, in one transaction.
//!
//! A batch's audit rows are its declaration that it must be recorded, but
//! appending them belongs to the one writer that computes the hash chain, and
//! this connection cannot chain them: a row stored here would carry no hash and
//! be indistinguishable from a tampered one. The rows are therefore handed back
//! to the caller, which appends them through that writer, and nothing is written
//! to `audit_log` from here. Everything else runs on one
//! [`sqlx::Transaction`] so a batch is all-or-nothing. The evaluation rows are
//! each written inside a savepoint: the reference's `begin_nested` swallows one
//! `IntegrityError` so a duplicate testcase cannot poison the whole batch.
//!
//! The completion rule reproduces `set_evaluation_outcome`: once the stored
//! evaluation count for a submission and dataset equals the dataset's testcase
//! count, the single enum value `ok` is stamped on the result row. Everything,
//! including that stamp, is committed once.

use sqlx::postgres::PgConnection;
use sqlx::Connection;

use super::batch::{AuditRow, ObjectWrite, OperationType};
use super::shapes::{
    CompilationOutcome, EvaluationOutcome, EvaluationRow, ExecutableRow, ResultRow, ScoreRow,
};
use super::statements::{
    CLEAR_SCORE_FOR_COMPILATION, INSERT_EXECUTABLES, UPSERT_RESULT, UPSERT_SCORE,
};
use crate::reads::{DatasetId, SubmissionId};

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
    /// A statement or the transaction itself was refused by the driver.
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    /// A write carried no audit row, so the change would go unrecorded.
    #[error("a user-test write must carry an audit row")]
    AuditNotWired,
}

/// Commit grouped object writes into rows in one transaction.
///
/// The batches come from [`group_by_object`](super::group_by_object), which
/// merges every operation on one object; each declares the audit rows it owes.
/// This layer returns those rows instead of storing them: the connection cannot
/// compute the chain, so the caller appends them through the one writer that
/// can. The result, executables, evaluations and score are written in that
/// order; for an [`OperationType::Evaluation`] group the completion rule stamps
/// `evaluation_outcome = 'ok'` when the stored evaluation count equals the
/// dataset's testcase count. One duplicate evaluation row is tolerated per row
/// without losing the others.
/// A Compilation group first invalidates the previous executables, evaluations
/// and score through the shared statements.
///
/// # Errors
///
/// Returns [`CommitError::Database`] when a statement or the transaction fails.
pub async fn commit(
    connection: &mut PgConnection,
    writes: &[ObjectWrite],
) -> Result<Vec<AuditRow>, CommitError> {
    let mut transaction = connection.begin().await?;
    for group in writes {
        write_result(&mut transaction, &group.result).await?;
        // A compilation invalidates what its predecessor produced, even when the set is empty.
        if group.operation == OperationType::Compilation {
            delete_executables(&mut transaction, group.submission_id, group.dataset_id).await?;
            delete_evaluations(&mut transaction, group.submission_id, group.dataset_id).await?;
            clear_score(&mut transaction, group.submission_id, group.dataset_id).await?;
        }
        if !group.executables.is_empty() {
            insert_executables(&mut transaction, &group.executables).await?;
        }
        write_evaluations(&mut transaction, &group.evaluations).await?;
        if let Some(score) = &group.score {
            upsert_score(&mut transaction, score).await?;
        }
    }
    for group in writes {
        if group.operation == OperationType::Evaluation {
            apply_completion(&mut transaction, group.submission_id, group.dataset_id).await?;
        }
    }
    transaction.commit().await?;
    Ok(writes
        .iter()
        .flat_map(|group| group.audit.iter().cloned())
        .collect())
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

/// Remove one object's whole executable set, the way the reference's
/// `invalidate_compilation` does before a compilation writes its replacement.
async fn delete_executables(
    connection: &mut PgConnection,
    submission: SubmissionId,
    dataset: DatasetId,
) -> Result<(), sqlx::Error> {
    sqlx::query(crate::DELETE_EXECUTABLES)
        .bind(submission.0)
        .bind(dataset.0)
        .execute(&mut *connection)
        .await?;
    Ok(())
}

/// Remove one object's whole evaluation set, the way `invalidate_evaluation` does.
async fn delete_evaluations(
    connection: &mut PgConnection,
    submission: SubmissionId,
    dataset: DatasetId,
) -> Result<(), sqlx::Error> {
    sqlx::query(crate::DELETE_EVALUATIONS)
        .bind(submission.0)
        .bind(dataset.0)
        .bind(None::<i32>)
        .execute(&mut *connection)
        .await?;
    Ok(())
}

/// Clear the five score fields, leaving the stamp the scoring pass set.
async fn clear_score(
    connection: &mut PgConnection,
    submission: SubmissionId,
    dataset: DatasetId,
) -> Result<(), sqlx::Error> {
    sqlx::query(CLEAR_SCORE_FOR_COMPILATION)
        .bind(submission.0)
        .bind(dataset.0)
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
