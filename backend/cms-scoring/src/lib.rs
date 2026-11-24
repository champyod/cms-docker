//! The scoring service's queue and database transactions.
//!
//! The queue preserves submission fairness, while the service boundary reads,
//! scores, writes and invalidates one result without exposing a partial update.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

pub mod queue;
pub mod service;

pub use queue::{ScoringOperation, ScoringQueue};
pub use service::{invalidate, score_candidate, ScoringServiceError};
