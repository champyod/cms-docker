//! The EvaluationService daemon's serial work loop and contest sweeper.
//!
//! The sweeper discovers work immediately and then every 117 seconds, matching
//! `EvaluationService.__init__` in `src/cms/service/EvaluationService.py:310`.
//! The worker pops one queued operation, reads its inputs, runs one job group,
//! maps every returned body to a write, commits that batch, and only then
//! applies the reference's end-of-operation effects: work still owed is
//! re-enqueued through the same-by-id planner, and ScoringService is notified
//! of a finished verdict.
//!
//! A notification failure never undoes a commit and never stops the loop; an
//! absent `SCORING_SERVICE_ADDR` skips notification with a log line.

mod effects;
mod notify;
mod work;

use std::fmt;
use std::sync::Arc;
use std::time::Duration;

use chrono::NaiveDateTime;

use cms_svc::{Client, Stop};

use crate::dispatch::WorkerDispatcher;
use crate::queue::EvaluationOperation;
use crate::service::Evaluation;

/// The reference sweeper's interval, with its first discovery running immediately.
pub const SWEEP_INTERVAL: Duration = Duration::from_secs(117);

const STOP_POLL: Duration = Duration::from_millis(50);

/// Why a loop could not finish one operation.
#[derive(Debug)]
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

impl fmt::Display for RunError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.operation, self.reason)
    }
}

impl std::error::Error for RunError {}

/// Discover operations immediately, then wait out each 117-second interval.
pub async fn sweeper(evaluation: Arc<Evaluation>, stop: Stop) {
    loop {
        if stop.is_requested() {
            return;
        }
        let started = tokio::time::Instant::now();
        if let Err(error) = evaluation.enqueue_contest(None).await {
            eprintln!("cms-evaluation: sweep failed: {error}");
        }
        wait_until(started + SWEEP_INTERVAL, &stop).await;
    }
}

/// Pop and run one operation at a time until the host asks the loop to stop.
///
/// The worker owns the shard dispatchers and one optional ScoringService client
/// for the whole run, so a broken connection is retried on the next call.
///
/// # Errors
///
/// Returns [`RunError`] when the queue is unusable; one failed operation is
/// logged and dropped, because the sweeper will rediscover work it still owes.
pub async fn worker(
    evaluation: Arc<Evaluation>,
    mut dispatcher: WorkerDispatcher,
    stop: Stop,
) -> Result<(), RunError> {
    let mut scoring = None;
    loop {
        if stop.is_requested() {
            return Ok(());
        }
        let Some((operation, timestamp)) = evaluation
            .pop()
            .map_err(|error| RunError::new("pop operation", error))?
        else {
            wait_for(STOP_POLL, &stop).await;
            continue;
        };
        if let Err(error) = work::process_one(
            &evaluation,
            &mut dispatcher,
            &mut scoring,
            operation,
            timestamp,
        )
        .await
        {
            eprintln!("cms-evaluation: {error}");
        }
    }
}

/// Runs exactly one queued operation, for callers that drive the loop by hand.
///
/// # Errors
///
/// Returns [`RunError`] naming the read, dispatch, mapping, commit or effect
/// that refused the operation.
pub async fn process_operation(
    evaluation: &Evaluation,
    dispatcher: &mut WorkerDispatcher,
    scoring: &mut Option<Client>,
    operation: EvaluationOperation,
    timestamp: NaiveDateTime,
) -> Result<(), RunError> {
    work::process_one(evaluation, dispatcher, scoring, operation, timestamp)
        .await
        .map_err(|error| RunError::new("process operation", error))
}

/// Dials ScoringService with a client the caller keeps between operations.
pub(super) fn notify_scoring(
    evaluation: &Evaluation,
    client: &mut Option<Client>,
    submission_id: i32,
    dataset_id: i32,
) {
    if let Err(error) = notify::scoring(evaluation, client, submission_id, dataset_id) {
        eprintln!(
            "cms-evaluation: scoring notification failed for submission {submission_id} on dataset {dataset_id}: {error}"
        );
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
