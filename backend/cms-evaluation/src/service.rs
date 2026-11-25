//! The EvaluationService's in-memory queue and its RPC surface.
//!
//! Requests touch only the queue; a sweep reads the database and enqueues the
//! planned operations. Result writing and worker dispatch belong to the runner,
//! so this context can be tested without a worker.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::sync::{Arc, Mutex, MutexGuard};

use chrono::NaiveDateTime;
use cms_db::Session;
use cms_proto::Method;
use serde_json::{json, Value};

use crate::queue::{EvaluationOperation, EvaluationQueue, QueueStatusEntry};
use crate::sweep::{contest_operations, submission_operations_by_id, user_test_operations_by_id};
use crate::PlannedOperation;

const NEW_SUBMISSION_METHOD: &str = "new_submission";
const NEW_USER_TEST_METHOD: &str = "new_user_test";
const QUEUE_STATUS_METHOD: &str = "queue_status";
const WORKERS_STATUS_METHOD: &str = "workers_status";
const SUBMISSION_ID_ARGUMENT: &str = "submission_id";
const USER_TEST_ID_ARGUMENT: &str = "user_test_id";
const POISONED: &str = "the evaluation queue is unusable after a panic while it was held";

/// The session and fair queue one EvaluationService shares.
///
/// Clones share the same session and queue.
#[derive(Clone)]
pub struct Evaluation {
    session: Arc<Session>,
    runtime: tokio::runtime::Handle,
    queue: Arc<Mutex<EvaluationQueue>>,
}

impl Evaluation {
    /// Builds one context over an open session and the runtime that drives its reads.
    #[must_use]
    pub fn new(session: Arc<Session>, runtime: tokio::runtime::Handle) -> Self {
        Self {
            session,
            runtime,
            queue: Arc::new(Mutex::new(EvaluationQueue::default())),
        }
    }

    /// The base RPC methods followed by the evaluation methods.
    #[must_use]
    pub fn methods() -> Vec<Method<Self>> {
        let mut methods = cms_svc::service::methods::<Self>();
        for (name, handler) in [
            (
                NEW_SUBMISSION_METHOD,
                new_submission as fn(&Value, &Self) -> Result<Value, String>,
            ),
            (NEW_USER_TEST_METHOD, new_user_test),
            (QUEUE_STATUS_METHOD, queue_status),
            (WORKERS_STATUS_METHOD, workers_status),
        ] {
            methods.push(Method {
                name,
                is_callable: true,
                handler,
            });
        }
        methods
    }

    /// The number of operations waiting.
    #[must_use]
    pub fn queue_len(&self) -> usize {
        self.queue.lock().expect(POISONED).len()
    }

    /// The cumulative queue status ordered by priority and timestamp.
    #[must_use]
    pub fn status(&self) -> Vec<QueueStatusEntry> {
        self.queue.lock().expect(POISONED).status()
    }

    /// Reads every operation one submission still owes and queues it.
    ///
    /// # Errors
    ///
    /// Returns a named database or queue failure.
    pub async fn enqueue_submission(&self, submission_id: i32) -> Result<usize, String> {
        let mut transaction = self
            .session
            .begin()
            .await
            .map_err(|error| format!("begin submission read: {error}"))?;
        let planned = submission_operations_by_id(transaction.connection(), submission_id)
            .await
            .map_err(|error| format!("read submission {submission_id}: {error}"))?;
        transaction
            .commit()
            .await
            .map_err(|error| format!("commit submission read: {error}"))?;
        self.enqueue(planned)
    }

    /// Reads every operation one user test still owes and queues it.
    ///
    /// # Errors
    ///
    /// Returns a named database or queue failure.
    pub async fn enqueue_user_test(&self, user_test_id: i32) -> Result<usize, String> {
        let mut transaction = self
            .session
            .begin()
            .await
            .map_err(|error| format!("begin user test read: {error}"))?;
        let planned = user_test_operations_by_id(transaction.connection(), user_test_id)
            .await
            .map_err(|error| format!("read user test {user_test_id}: {error}"))?;
        transaction
            .commit()
            .await
            .map_err(|error| format!("commit user test read: {error}"))?;
        self.enqueue(planned)
    }

    /// Reads every operation one contest still owes and queues it.
    ///
    /// # Errors
    ///
    /// Returns a named database or queue failure.
    pub async fn enqueue_contest(&self, contest_id: Option<i32>) -> Result<usize, String> {
        let mut transaction = self
            .session
            .begin()
            .await
            .map_err(|error| format!("begin contest sweep: {error}"))?;
        let planned = contest_operations(transaction.connection(), contest_id)
            .await
            .map_err(|error| format!("sweep contest: {error}"))?;
        transaction
            .commit()
            .await
            .map_err(|error| format!("commit contest sweep: {error}"))?;
        self.enqueue(planned)
    }

    /// Queues planned operations and returns how many were new.
    ///
    /// # Errors
    ///
    /// Returns [`POISONED`] when a panic left the queue locked.
    pub fn enqueue(&self, planned: Vec<PlannedOperation>) -> Result<usize, String> {
        let mut queue = self.queue()?;
        let mut inserted = 0;
        for operation in planned {
            if queue.push(
                EvaluationOperation {
                    operation: operation.operation,
                    priority: operation.priority,
                },
                operation.timestamp,
            ) {
                inserted += 1;
            }
        }
        Ok(inserted)
    }

    /// Removes and returns the most urgent operation, if any.
    ///
    /// # Errors
    ///
    /// Returns [`POISONED`] when a panic left the queue locked.
    pub fn pop(&self) -> Result<Option<(EvaluationOperation, NaiveDateTime)>, String> {
        Ok(self.queue()?.pop())
    }

    fn queue(&self) -> Result<MutexGuard<'_, EvaluationQueue>, String> {
        self.queue.lock().map_err(|_| POISONED.to_owned())
    }
}

/// Queue the new submission's missing operations and return the reference's null.
///
/// # Errors
///
/// Refuses a missing or non-integer id, or a database read the service cannot finish.
pub fn new_submission(data: &Value, evaluation: &Evaluation) -> Result<Value, String> {
    let submission_id = required_i32(data, SUBMISSION_ID_ARGUMENT, NEW_SUBMISSION_METHOD)?;
    evaluation
        .runtime
        .block_on(evaluation.enqueue_submission(submission_id))?;
    Ok(Value::Null)
}

/// Queue the new user test's missing operations and return the reference's null.
///
/// # Errors
///
/// Refuses a missing or non-integer id, or a database read the service cannot finish.
pub fn new_user_test(data: &Value, evaluation: &Evaluation) -> Result<Value, String> {
    let user_test_id = required_i32(data, USER_TEST_ID_ARGUMENT, NEW_USER_TEST_METHOD)?;
    evaluation
        .runtime
        .block_on(evaluation.enqueue_user_test(user_test_id))?;
    Ok(Value::Null)
}

/// Return the cumulative status in the reference's list shape.
pub fn queue_status(_data: &Value, evaluation: &Evaluation) -> Result<Value, String> {
    let status: Vec<Value> = evaluation
        .status()
        .into_iter()
        .map(|entry| {
            json!({
                "item": {
                    "type": entry.kind.name(),
                    "object_id": entry.object_id,
                    "dataset_id": entry.dataset_id,
                    "multiplicity": entry.multiplicity,
                },
                "priority": entry.priority,
                "timestamp": timestamp(entry.timestamp),
            })
        })
        .collect();
    Ok(Value::Array(status))
}

/// The worker pool is not part of this context yet; the reference's empty map is.
pub fn workers_status(_data: &Value, _evaluation: &Evaluation) -> Result<Value, String> {
    Ok(json!({}))
}

fn required_i32(data: &Value, argument: &str, method: &str) -> Result<i32, String> {
    data.get(argument)
        .and_then(Value::as_i64)
        .and_then(|value| i32::try_from(value).ok())
        .ok_or_else(|| format!("{method}() requires an integer `{argument}`"))
}

fn timestamp(timestamp: NaiveDateTime) -> f64 {
    timestamp.and_utc().timestamp() as f64
        + f64::from(timestamp.and_utc().timestamp_subsec_micros()) / 1_000_000.0
}
