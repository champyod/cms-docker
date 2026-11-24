//! The scoring daemon's database sweeper and serial scoring worker.
//!
//! The sweeper discovers unscored results immediately and every 347 seconds.
//! The worker scores one operation at a time, retrying a failed score three times
//! before dropping it for the next sweep. After a committed score it notifies
//! ProxyService only when a proxy address is configured and the bundle's dataset
//! is active; a proxy refusal is logged and never rolls the score back.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::fmt;
use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use cms_db::{read_result_bundle, scoring_candidates, ScoreRow, ScoringCandidate, SessionError};
use cms_svc::{Client, Stop};
use serde_json::json;

use crate::api::Scoring;
use crate::service::{score_candidate, ScoringServiceError};

#[cfg(test)]
mod tests;

/// The reference sweeper's interval, with its first discovery running immediately.
pub const SWEEP_INTERVAL: Duration = Duration::from_secs(347);

const MAX_RETRIES: u32 = 3;
const STOP_POLL: Duration = Duration::from_millis(50);
const RETRY_PAUSE: Duration = Duration::from_millis(100);
const PROXY_METHOD: &str = "submission_scored";
const SUBMISSION_ID_ARGUMENT: &str = "submission_id";

/// Why a loop could not read or mutate its queue.
#[derive(Debug, thiserror::Error)]
#[error("{operation}: {reason}")]
pub struct RunError {
    operation: &'static str,
    reason: String,
}

impl RunError {
    fn new(operation: &'static str, error: impl fmt::Display) -> Self {
        Self {
            operation,
            reason: error.to_string(),
        }
    }
}

/// Discover candidates immediately, then wait out each 347-second interval.
///
/// Database and queue failures are logged and retried on the next interval.
pub async fn sweeper(scoring: Arc<Scoring>, stop: Stop) {
    loop {
        if stop.is_requested() {
            return;
        }
        let started = tokio::time::Instant::now();
        if let Err(error) = sweep_once(&scoring).await {
            eprintln!("cms-scoring: sweep failed: {error}");
        }
        wait_until(started + SWEEP_INTERVAL, &stop).await;
    }
}

/// Read every currently unscored candidate and enqueue it with its submission timestamp.
///
/// # Errors
///
/// Returns [`RunError`] when the database cannot be read or the queue cannot accept the candidates.
pub async fn sweep_once(scoring: &Scoring) -> Result<usize, RunError> {
    let mut transaction = scoring
        .session()
        .begin()
        .await
        .map_err(|error| RunError::new("begin sweep", error))?;
    let candidates = scoring_candidates(transaction.connection())
        .await
        .map_err(|error| RunError::new("read scoring candidates", error))?;
    transaction
        .commit()
        .await
        .map_err(|error| RunError::new("commit sweep", error))?;
    for candidate in &candidates {
        scoring
            .enqueue_candidate(candidate.clone())
            .map_err(|error| RunError::new("enqueue scoring candidate", error))?;
    }
    Ok(candidates.len())
}

/// Pop and score one candidate at a time until the host asks the loop to stop.
///
/// # Errors
///
/// Returns [`RunError`] when a poisoned queue prevents the worker from popping its next operation.
pub async fn worker(scoring: Arc<Scoring>, stop: Stop) -> Result<(), RunError> {
    let mut proxy = None;
    loop {
        if stop.is_requested() {
            return Ok(());
        }
        let next = scoring
            .pop()
            .map_err(|error| RunError::new("pop scoring candidate", error))?;
        let Some((operation, timestamp)) = next else {
            wait_for(STOP_POLL, &stop).await;
            continue;
        };
        let candidate = ScoringCandidate {
            submission_id: operation.submission_id,
            dataset_id: operation.dataset_id,
            timestamp,
        };
        score_one(&scoring, &candidate, &stop, &mut proxy).await;
    }
}

async fn score_one(
    scoring: &Arc<Scoring>,
    candidate: &ScoringCandidate,
    stop: &Stop,
    proxy: &mut Option<Client>,
) {
    let owned_scoring = Arc::clone(scoring);
    let owned_candidate = candidate.clone();
    let scored: Result<(ScoreRow, bool), ScoringServiceError> =
        retry_score("score candidate", stop, move || {
            let scoring = Arc::clone(&owned_scoring);
            let candidate = owned_candidate.clone();
            async move {
                let (row, is_active) = score_active_candidate(&scoring, &candidate).await?;
                Ok((row, is_active))
            }
        })
        .await;
    match scored {
        Ok((_, true)) => {
            if let Err(error) = notify_proxy(scoring, proxy, candidate.submission_id.0) {
                eprintln!(
                    "cms-scoring: proxy notification failed for submission {}: {error}",
                    candidate.submission_id.0
                );
            }
        }
        Ok((_, false)) => {}
        Err(error) => eprintln!(
            "cms-scoring: dropped submission {} on dataset {} after retries: {error}",
            candidate.submission_id.0, candidate.dataset_id.0
        ),
    }
}

async fn score_active_candidate(
    scoring: &Scoring,
    candidate: &ScoringCandidate,
) -> Result<(ScoreRow, bool), ScoringServiceError> {
    let mut transaction = scoring.session().begin().await?;
    let bundle = read_result_bundle(transaction.connection(), candidate).await?;
    transaction
        .commit()
        .await
        .map_err(|error| ScoringServiceError::Commit(SessionError::Database(error)))?;
    let row = score_candidate(scoring.session(), candidate, Utc::now().naive_utc()).await?;
    Ok((row, bundle.dataset.is_active))
}

fn notify_proxy(
    scoring: &Scoring,
    proxy: &mut Option<Client>,
    submission_id: i32,
) -> Result<(), String> {
    let Some(address) = scoring.proxy_address() else {
        return Ok(());
    };
    let connection = match proxy.as_mut() {
        Some(connection) => connection,
        None => proxy.insert(
            Client::connect(address, scoring.rpc_secret().map(str::to_owned))
                .map_err(|error| error.to_string())?,
        ),
    };
    let result = connection.call(PROXY_METHOD, json!({SUBMISSION_ID_ARGUMENT: submission_id}));
    if result.is_err() {
        *proxy = None;
    }
    result.map(|_| ()).map_err(|error| error.to_string())
}

pub(super) async fn retry_score<T, E, F, Fut>(
    operation: &'static str,
    stop: &Stop,
    mut score: F,
) -> Result<T, E>
where
    E: fmt::Display,
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T, E>>,
{
    let mut retries = 0;
    loop {
        match score().await {
            Ok(value) => return Ok(value),
            Err(error) => {
                if retries == MAX_RETRIES || stop.is_requested() {
                    return Err(error);
                }
                retries += 1;
                eprintln!(
                    "cms-scoring: {operation} failed; retry {retries}/{MAX_RETRIES}: {error}"
                );
                wait_for(RETRY_PAUSE, stop).await;
                if stop.is_requested() {
                    return Err(error);
                }
            }
        }
    }
}

async fn wait_for(duration: Duration, stop: &Stop) {
    wait_until(tokio::time::Instant::now() + duration, stop).await;
}

async fn wait_until(deadline: tokio::time::Instant, stop: &Stop) {
    while !stop.is_requested() {
        let now = tokio::time::Instant::now();
        if now >= deadline {
            return;
        }
        tokio::time::sleep((deadline - now).min(STOP_POLL)).await;
    }
}
