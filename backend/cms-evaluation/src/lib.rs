//! Pure planning for the operations the EvaluationService queues.
//!
//! Predicates decide whether one result still needs work, and planners turn
//! that decision into the protocol's existing [`Operation`] records without
//! reading or writing the database.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use chrono::NaiveDateTime;
use cms_proto::Operation;

pub mod dispatch;
pub mod job;
pub mod operation;
pub mod plan;
pub mod queue;
pub mod result;
pub mod result_mapping;
pub mod run;
pub mod runner;
pub mod service;
pub mod sweep;
pub mod user_test_job;

pub use dispatch::{DispatchError, WorkerDispatcher};
pub use job::{submission_job, SubmissionJobError};
pub use operation::{
    submission_to_compile, submission_to_evaluate, submission_to_evaluate_on_testcase,
    user_test_to_compile, user_test_to_evaluate, MAX_COMPILATION_TRIES, MAX_EVALUATION_TRIES,
    MAX_USER_TEST_COMPILATION_TRIES, MAX_USER_TEST_EVALUATION_TRIES,
};
pub use plan::{
    compilation_priority, evaluation_priority, submission_operations, user_test_operations,
};
pub use queue::{EvaluationOperation, EvaluationQueue, QueueStatusEntry};
pub use result::{worker_output, RunStats, WorkerOutput, WorkerOutputError};
pub use result_mapping::{map_result, map_user_test_result, MapError};
pub use run::{process_operation, sweeper, worker, RunError, SWEEP_INTERVAL};
pub use runner::{run_submission, run_user_test, RunnerError};
pub use service::Evaluation;
pub use sweep::{contest_operations, submission_operations_by_id, user_test_operations_by_id};
pub use user_test_job::{user_test_job, UserTestJobError};

#[cfg(test)]
mod support;

/// One operation together with the queue position its source row assigns.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedOperation {
    /// The exact five-key operation record the worker protocol carries.
    pub operation: Operation,
    /// The queue priority, using the protocol's existing numeric levels.
    pub priority: i32,
    /// The source submission or user test timestamp, without a zone.
    pub timestamp: NaiveDateTime,
}
