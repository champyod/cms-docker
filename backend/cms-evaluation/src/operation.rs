//! Predicates that decide whether a result still needs compilation or evaluation.

use cms_db::{Evaluation, SubmissionResult, UserTestResult};

/// Compilation attempts allowed before a submission is left alone.
pub const MAX_COMPILATION_TRIES: i32 = 3;

/// Evaluation attempts allowed before a submission is left alone.
pub const MAX_EVALUATION_TRIES: i32 = 3;

/// Compilation attempts allowed before a user test is left alone.
pub const MAX_USER_TEST_COMPILATION_TRIES: i32 = 3;

/// Evaluation attempts allowed before a user test is left alone.
pub const MAX_USER_TEST_EVALUATION_TRIES: i32 = 3;

/// Whether a submission has no result or an unfinished compilation below its retry limit.
#[must_use]
pub fn submission_to_compile(result: Option<&SubmissionResult>) -> bool {
    result
        .is_none_or(|result| !result.compiled() && result.compilation_tries < MAX_COMPILATION_TRIES)
}

/// Whether a submission compiled successfully and still needs evaluation below its retry limit.
#[must_use]
pub fn submission_to_evaluate(result: Option<&SubmissionResult>) -> bool {
    result.is_some_and(|result| {
        result.compilation_succeeded()
            && !result.evaluated()
            && result.evaluation_tries < MAX_EVALUATION_TRIES
    })
}

/// Whether an eligible submission still needs the one testcase evaluated.
#[must_use]
pub fn submission_to_evaluate_on_testcase(
    result: &SubmissionResult,
    testcase_id: i32,
    evaluations: &[Evaluation],
) -> bool {
    submission_to_evaluate(Some(result))
        && !evaluations
            .iter()
            .any(|evaluation| evaluation.testcase_id == testcase_id)
}

/// Whether a user test has no result or an unfinished compilation below its retry limit.
#[must_use]
pub fn user_test_to_compile(result: Option<&UserTestResult>) -> bool {
    result.is_none_or(|result| {
        !result.compiled() && result.compilation_tries < MAX_USER_TEST_COMPILATION_TRIES
    })
}

/// Whether a user test compiled successfully and still needs evaluation below its retry limit.
#[must_use]
pub fn user_test_to_evaluate(result: Option<&UserTestResult>) -> bool {
    result.is_some_and(|result| {
        result.compilation_succeeded()
            && !result.evaluated()
            && result.evaluation_tries < MAX_USER_TEST_EVALUATION_TRIES
    })
}

#[cfg(test)]
mod tests;
