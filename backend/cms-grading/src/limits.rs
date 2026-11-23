//! The attempt caps a submission and a user test are given.
//!
//! They are read by the service that enforces them and by the dashboard that counts
//! the submissions sitting at the cap, so neither of those two owns them
//! (`EvaluationService.py:253` asks for exactly this move in its own comment).

/// The compilation failures a submission may collect before it is counted as exhausted.
pub const MAX_COMPILATION_TRIES: i32 = 3;

/// The evaluation failures a submission may collect before it is counted as exhausted.
pub const MAX_EVALUATION_TRIES: i32 = 3;

/// The compilation failures one user test may collect.
pub const MAX_USER_TEST_COMPILATION_TRIES: i32 = 3;

/// The evaluation failures one user test may collect.
pub const MAX_USER_TEST_EVALUATION_TRIES: i32 = 3;
