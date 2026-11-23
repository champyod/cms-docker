//! The attempt caps a submission and a user test are given: read by the service that enforces one and the
//! dashboard that counts the other, so neither owns them (`EvaluationService.py:253` asks for the move).

/// The compilation failures a submission may collect before it is counted as exhausted.
pub const MAX_COMPILATION_TRIES: i32 = 3;

/// The evaluation failures a submission may collect before it is counted as exhausted.
pub const MAX_EVALUATION_TRIES: i32 = 3;

/// The compilation failures one user test may collect.
pub const MAX_USER_TEST_COMPILATION_TRIES: i32 = 3;

/// The evaluation failures one user test may collect.
pub const MAX_USER_TEST_EVALUATION_TRIES: i32 = 3;
