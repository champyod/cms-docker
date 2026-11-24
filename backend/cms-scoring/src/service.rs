//! One-candidate scoring transactions and score invalidation.
//!
//! Every scoring pass reads its bundle, computes and writes its score in one
//! caller-owned transaction. Invalidation uses the same boundary, committing the
//! cleared scores before their candidates are handed back for fair queueing.

use chrono::NaiveDateTime;

use cms_db::{
    get_submission_results, invalidate_score, read_result_bundle, write_score, ResultFilter,
    ScoreRow, ScoringCandidate, ScoringReadError, SearchError, Session, SessionError,
    SubmissionResult, Transaction,
};
use cms_grading::scoring::{score as compute_score, ScoringError, ScoringInput};

/// Why a scoring service transaction could not finish.
#[derive(Debug, thiserror::Error)]
pub enum ScoringServiceError {
    /// The session could not begin a stamped transaction.
    #[error(transparent)]
    Begin(#[from] SessionError),
    /// The candidate's scoring records could not be read.
    #[error(transparent)]
    Read(#[from] ScoringReadError),
    /// The result filter was invalid or its rows could not be read.
    #[error(transparent)]
    Filter(#[from] SearchError),
    /// The pure scoring core refused the candidate.
    #[error(transparent)]
    Score(#[from] ScoringError),
    /// The computed score could not be written.
    #[error(transparent)]
    Write(SessionError),
    /// A selected result's score could not be invalidated.
    #[error(transparent)]
    Invalidate(SessionError),
    /// The completed transaction could not commit.
    #[error(transparent)]
    Commit(SessionError),
    /// An earlier failure could not be rolled back.
    #[error("rolling back after {operation} failed: {source}")]
    Rollback {
        /// The operation whose failure triggered the rollback.
        operation: &'static str,
        /// The driver's rollback refusal.
        #[source]
        source: SessionError,
    },
}

/// Read, score and persist one candidate in a single transaction.
///
/// # Errors
///
/// Returns [`ScoringServiceError::Read`] when the bundle cannot be read,
/// [`ScoringServiceError::Score`] when the scoring core refuses it, and the named
/// database variant when beginning, writing, committing or rolling back fails.
pub async fn score_candidate(
    session: &Session,
    candidate: &ScoringCandidate,
    scored_at: NaiveDateTime,
) -> Result<ScoreRow, ScoringServiceError> {
    let mut transaction = session.begin().await?;
    let bundle = match read_result_bundle(transaction.connection(), candidate).await {
        Ok(bundle) => bundle,
        Err(error) => {
            return rollback(transaction, "read", ScoringServiceError::Read(error)).await;
        }
    };
    let row = match compute_score(
        &ScoringInput {
            dataset: &bundle.dataset,
            task: &bundle.task,
            result: &bundle.result,
            evaluations: &bundle.evaluations,
            testcases: &bundle.testcases,
        },
        scored_at,
    ) {
        Ok(row) => row,
        Err(error) => {
            return rollback(transaction, "score", ScoringServiceError::Score(error)).await;
        }
    };
    if let Err(error) = write_score(transaction.connection(), &row).await {
        return rollback(
            transaction,
            "write",
            ScoringServiceError::Write(SessionError::Database(error)),
        )
        .await;
    }
    transaction
        .commit()
        .await
        .map_err(|error| ScoringServiceError::Commit(SessionError::Database(error)))?;
    Ok(row)
}

/// Invalidate every fully scored result matching `filter` in one transaction.
///
/// The returned candidates carry their submission timestamps in fair queue order.
/// A partially populated score is left untouched, matching the reference's scored rule.
///
/// # Errors
///
/// Returns [`ScoringServiceError::Filter`] for a refused filter or result read,
/// [`ScoringServiceError::Invalidate`] when a score cannot be cleared, and the named
/// database variant when beginning, committing or rolling back fails.
pub async fn invalidate(
    session: &Session,
    filter: &ResultFilter,
) -> Result<Vec<ScoringCandidate>, ScoringServiceError> {
    filter.validate()?;
    let mut transaction = session.begin().await?;
    let results = match get_submission_results(transaction.connection(), filter).await {
        Ok(results) => results,
        Err(error) => {
            return rollback(
                transaction,
                "read results",
                ScoringServiceError::Filter(error),
            )
            .await;
        }
    };
    let mut candidates = Vec::with_capacity(results.len());
    for result in results {
        match invalidate_result(&mut transaction, &result).await {
            Ok(Some(candidate)) => candidates.push(candidate),
            Ok(None) => {}
            Err(error) => return rollback(transaction, "invalidate", error).await,
        }
    }
    candidates.sort_by_key(|candidate| {
        (
            candidate.timestamp,
            candidate.submission_id,
            candidate.dataset_id,
        )
    });
    transaction
        .commit()
        .await
        .map_err(|error| ScoringServiceError::Commit(SessionError::Database(error)))?;
    Ok(candidates)
}

async fn invalidate_result(
    transaction: &mut Transaction,
    result: &SubmissionResult,
) -> Result<Option<ScoringCandidate>, ScoringServiceError> {
    let timestamp = invalidate_score(
        transaction.connection(),
        result.submission_id,
        result.dataset_id,
    )
    .await
    .map_err(|error| ScoringServiceError::Invalidate(SessionError::Database(error)))?;
    Ok(timestamp.map(|timestamp| ScoringCandidate {
        submission_id: result.submission_id,
        dataset_id: result.dataset_id,
        timestamp,
    }))
}

async fn rollback<T>(
    transaction: Transaction,
    operation: &'static str,
    error: ScoringServiceError,
) -> Result<T, ScoringServiceError> {
    transaction
        .rollback()
        .await
        .map_err(|source| ScoringServiceError::Rollback {
            operation,
            source: SessionError::Database(source),
        })?;
    Err(error)
}
