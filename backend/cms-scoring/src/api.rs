//! The scoring daemon's RPC context and method table.
//!
//! Requests only enqueue work; the worker loop performs database transactions and
//! notifies ProxyService after a committed score. Notification is attempted only
//! when `PROXY_SERVICE_ADDR` is set and the scored dataset is active. A refused
//! proxy call is logged without undoing the committed score, and an absent address
//! skips notification entirely.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::sync::{Arc, Mutex, MutexGuard};

use chrono::{NaiveDateTime, Utc};
use cms_db::{DatasetId, ResultFilter, ScoringCandidate, Session, SubmissionId};
use cms_proto::Method;
use serde_json::Value;

use crate::queue::{ScoringOperation, ScoringQueue};

const NEW_EVALUATION_METHOD: &str = "new_evaluation";
const INVALIDATE_METHOD: &str = "invalidate_submission";
const SUBMISSION_ID_ARGUMENT: &str = "submission_id";
const DATASET_ID_ARGUMENT: &str = "dataset_id";
const PARTICIPATION_ID_ARGUMENT: &str = "participation_id";
const TASK_ID_ARGUMENT: &str = "task_id";
const CONTEST_ID_ARGUMENT: &str = "contest_id";
const POISONED: &str = "the scoring queue is unusable after a panic while it was held";

/// The session, fair queue and optional proxy endpoint one scoring daemon shares.
///
/// Clones share the same session and queue.
#[derive(Clone)]
pub struct Scoring {
    session: Arc<Session>,
    runtime: tokio::runtime::Handle,
    queue: Arc<Mutex<ScoringQueue>>,
    proxy_address: Option<String>,
    rpc_secret: Option<String>,
}

impl Scoring {
    /// Builds one context over an open session and the runtime that drives its transactions.
    #[must_use]
    pub fn new(
        session: Arc<Session>,
        runtime: tokio::runtime::Handle,
        proxy_address: Option<String>,
        rpc_secret: Option<String>,
    ) -> Self {
        Self {
            session,
            runtime,
            queue: Arc::new(Mutex::new(ScoringQueue::default())),
            proxy_address,
            rpc_secret,
        }
    }

    /// The base RPC methods followed by the scoring methods.
    #[must_use]
    pub fn methods() -> Vec<Method<Self>> {
        let mut methods = cms_svc::service::methods::<Self>();
        methods.push(Method {
            name: NEW_EVALUATION_METHOD,
            is_callable: true,
            handler: new_evaluation,
        });
        methods.push(Method {
            name: INVALIDATE_METHOD,
            is_callable: true,
            handler: invalidate_submission,
        });
        methods
    }

    /// The number of distinct operations waiting to be scored.
    #[must_use]
    pub fn queue_len(&self) -> usize {
        self.queue.lock().expect(POISONED).len()
    }

    /// The optional ProxyService address the worker dials after an active score.
    #[must_use]
    pub fn proxy_address(&self) -> Option<&str> {
        self.proxy_address.as_deref()
    }

    /// The optional RPC secret shared with ProxyService.
    #[must_use]
    pub fn rpc_secret(&self) -> Option<&str> {
        self.rpc_secret.as_deref()
    }

    pub(crate) fn session(&self) -> &Session {
        &self.session
    }

    pub(crate) fn enqueue_candidate(&self, candidate: ScoringCandidate) -> Result<bool, String> {
        self.enqueue(
            ScoringOperation {
                submission_id: candidate.submission_id,
                dataset_id: candidate.dataset_id,
            },
            candidate.timestamp,
        )
    }

    pub(crate) fn pop(&self) -> Result<Option<(ScoringOperation, NaiveDateTime)>, String> {
        Ok(self.queue()?.pop())
    }

    fn enqueue(
        &self,
        operation: ScoringOperation,
        timestamp: NaiveDateTime,
    ) -> Result<bool, String> {
        Ok(self.queue()?.push(operation, timestamp))
    }

    fn queue(&self) -> Result<MutexGuard<'_, ScoringQueue>, String> {
        self.queue.lock().map_err(|_| POISONED.to_owned())
    }
}

/// Schedule one submission result for scoring and return the reference's null result.
///
/// # Errors
///
/// Refuses a missing or non-integer id, or a queue lock left unusable by a panic.
pub fn new_evaluation(data: &Value, scoring: &Scoring) -> Result<Value, String> {
    let submission_id = required_i32(data, SUBMISSION_ID_ARGUMENT, NEW_EVALUATION_METHOD)?;
    let dataset_id = required_i32(data, DATASET_ID_ARGUMENT, NEW_EVALUATION_METHOD)?;
    scoring.enqueue(
        ScoringOperation {
            submission_id: SubmissionId(submission_id),
            dataset_id: DatasetId(dataset_id),
        },
        Utc::now().naive_utc(),
    )?;
    Ok(Value::Null)
}

/// Invalidate matching fully scored results, then enqueue them in fair timestamp order.
///
/// # Errors
///
/// Refuses malformed filters with the filter's named error, and reports database
/// or queue failures without enqueueing work whose invalidation did not commit.
pub fn invalidate_submission(data: &Value, scoring: &Scoring) -> Result<Value, String> {
    let filter = ResultFilter {
        submission_id: optional_i32(data, SUBMISSION_ID_ARGUMENT, INVALIDATE_METHOD)?
            .map(SubmissionId),
        dataset_id: optional_i32(data, DATASET_ID_ARGUMENT, INVALIDATE_METHOD)?.map(DatasetId),
        participation_id: optional_i32(data, PARTICIPATION_ID_ARGUMENT, INVALIDATE_METHOD)?,
        task_id: optional_i32(data, TASK_ID_ARGUMENT, INVALIDATE_METHOD)?,
        contest_id: optional_i32(data, CONTEST_ID_ARGUMENT, INVALIDATE_METHOD)?,
    };
    filter.validate().map_err(|error| error.to_string())?;
    let candidates = scoring
        .runtime
        .block_on(crate::invalidate(scoring.session(), &filter))
        .map_err(|error| error.to_string())?;
    for candidate in candidates {
        scoring.enqueue_candidate(candidate)?;
    }
    Ok(Value::Null)
}

fn required_i32(data: &Value, argument: &str, method: &str) -> Result<i32, String> {
    data.get(argument)
        .and_then(Value::as_i64)
        .and_then(|value| i32::try_from(value).ok())
        .ok_or_else(|| format!("{method}() requires an integer `{argument}`"))
}

fn optional_i32(data: &Value, argument: &str, method: &str) -> Result<Option<i32>, String> {
    match data.get(argument) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value
            .as_i64()
            .and_then(|value| i32::try_from(value).ok())
            .map(Some)
            .ok_or_else(|| format!("{method}() requires an integer `{argument}`")),
    }
}
