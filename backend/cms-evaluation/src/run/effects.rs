//! The reference's end-of-operation effects, applied only after the commit.
//!
//! A compilation whose worker reported failure and whose stored outcome is
//! still absent reaches a terminal `fail` once it has used all three tries;
//! without that stamp it would sit in COMPILING with no recovery
//! (`EvaluationService.py:801-828`). ScoringService is told about a failed
//! compilation, a terminal compilation and a fully evaluated submission, but
//! a failed evaluation is only logged (`EvaluationService.py:853-875`).
//! Whatever the verdict, the same-by-id planner re-enqueues what is still owed.

use cms_db::{result_by_id, user_test_result, CompilationOutcome, DatasetId, SubmissionId};
use cms_proto::OperationKind;
use cms_svc::Client;

use super::notify_scoring;
use crate::operation::MAX_COMPILATION_TRIES;
use crate::service::Evaluation;
use crate::WorkerOutput;

const MARK_COMPILATION_FAILED: &str = "\
    UPDATE submission_results SET compilation_outcome = 'fail' \
    WHERE submission_id = $1 AND dataset_id = $2 \
      AND compilation_outcome IS NULL AND compilation_tries >= $3";

/// Applies one submission operation's effects after its batch has committed.
///
/// # Errors
///
/// Returns a named database, terminal-mark or queue failure.
pub(super) async fn after_submission(
    evaluation: &Evaluation,
    scoring: &mut Option<Client>,
    kind: OperationKind,
    submission_id: i32,
    dataset_id: i32,
    outputs: &[WorkerOutput],
) -> Result<(), String> {
    let stored = stored_submission(evaluation, submission_id, dataset_id).await?;
    match kind {
        OperationKind::Compilation => {
            let failed = outputs
                .iter()
                .any(|output| !output.success || output.compilation_success == Some(false));
            let rejected = stored.compilation_outcome == Some(CompilationOutcome::Fail);
            let mut terminal = false;
            if failed && stored.compilation_outcome.is_none() {
                terminal = stored.compilation_tries >= MAX_COMPILATION_TRIES;
                if terminal {
                    mark_failed(evaluation, submission_id, dataset_id).await?;
                }
            }
            if rejected || terminal {
                notify_scoring(evaluation, scoring, submission_id, dataset_id);
            }
        }
        OperationKind::Evaluation if stored.evaluated() => {
            notify_scoring(evaluation, scoring, submission_id, dataset_id);
        }
        OperationKind::Evaluation => {
            eprintln!("cms-evaluation: worker failed to evaluate submission {submission_id}({dataset_id})");
        }
        other => {
            eprintln!("cms-evaluation: no submission effect for operation kind {other:?}");
        }
    }
    evaluation
        .enqueue_submission(submission_id)
        .await
        .map_err(|error| format!("re-enqueue submission {submission_id}: {error}"))?;
    Ok(())
}

/// Applies one user test's effects: no score notification, always re-enqueue.
///
/// # Errors
///
/// Returns a named database read or queue failure.
pub(super) async fn after_user_test(
    evaluation: &Evaluation,
    kind: OperationKind,
    user_test_id: i32,
    dataset_id: i32,
) -> Result<(), String> {
    let mut transaction = evaluation
        .session()
        .begin()
        .await
        .map_err(|error| format!("begin user test effect read: {error}"))?;
    let stored = user_test_result(
        transaction.connection(),
        user_test_id,
        DatasetId(dataset_id),
    )
    .await
    .map_err(|error| format!("read user test result: {error}"))?;
    transaction
        .commit()
        .await
        .map_err(|error| format!("commit user test effect read: {error}"))?;
    if let Some(result) = stored {
        eprintln!(
            "cms-evaluation: user test {user_test_id}({dataset_id}) {kind:?} status {:?}",
            result.status()
        );
    }
    evaluation
        .enqueue_user_test(user_test_id)
        .await
        .map_err(|error| format!("re-enqueue user test {user_test_id}: {error}"))?;
    Ok(())
}

async fn stored_submission(
    evaluation: &Evaluation,
    submission_id: i32,
    dataset_id: i32,
) -> Result<cms_db::SubmissionResult, String> {
    let mut transaction = evaluation
        .session()
        .begin()
        .await
        .map_err(|error| format!("begin submission effect read: {error}"))?;
    let stored = result_by_id(
        transaction.connection(),
        SubmissionId(submission_id),
        DatasetId(dataset_id),
    )
    .await
    .map_err(|error| format!("read submission result: {error}"))?
    .ok_or_else(|| format!("submission {submission_id}({dataset_id}) has no result"))?;
    transaction
        .commit()
        .await
        .map_err(|error| format!("commit submission effect read: {error}"))?;
    Ok(stored)
}

async fn mark_failed(
    evaluation: &Evaluation,
    submission_id: i32,
    dataset_id: i32,
) -> Result<(), String> {
    let mut transaction = evaluation
        .session()
        .begin()
        .await
        .map_err(|error| format!("begin terminal mark: {error}"))?;
    sqlx::query(MARK_COMPILATION_FAILED)
        .bind(submission_id)
        .bind(dataset_id)
        .bind(MAX_COMPILATION_TRIES)
        .execute(transaction.connection())
        .await
        .map_err(|error| format!("mark compilation failed: {error}"))?;
    transaction
        .commit()
        .await
        .map_err(|error| format!("commit terminal mark: {error}"))?;
    Ok(())
}
