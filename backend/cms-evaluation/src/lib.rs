//! Pure planning for the operations the EvaluationService queues.
//!
//! Predicates decide whether one result still needs work, and planners turn
//! that decision into the protocol's existing [`Operation`] records without
//! reading or writing the database.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use chrono::NaiveDateTime;
use cms_proto::Operation;

pub mod operation;
pub mod plan;
pub mod sweep;

pub use operation::{
    submission_to_compile, submission_to_evaluate, submission_to_evaluate_on_testcase,
    user_test_to_compile, user_test_to_evaluate, MAX_COMPILATION_TRIES, MAX_EVALUATION_TRIES,
    MAX_USER_TEST_COMPILATION_TRIES, MAX_USER_TEST_EVALUATION_TRIES,
};
pub use plan::{
    compilation_priority, evaluation_priority, submission_operations, user_test_operations,
};
pub use sweep::contest_operations;

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
