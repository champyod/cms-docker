use cms_db::CompilationOutcome;

use super::*;
use crate::support::{evaluation, submission_result, user_test_result};

#[test]
fn retry_limits_are_three() {
    assert_eq!(MAX_COMPILATION_TRIES, 3);
    assert_eq!(MAX_EVALUATION_TRIES, 3);
    assert_eq!(MAX_USER_TEST_COMPILATION_TRIES, 3);
    assert_eq!(MAX_USER_TEST_EVALUATION_TRIES, 3);
}

#[test]
fn missing_submission_result_needs_compilation() {
    assert!(submission_to_compile(None));
}

#[test]
fn unfinished_submission_compilation_is_retried_below_limit() {
    let mut result = submission_result();
    for tries in 0..MAX_COMPILATION_TRIES {
        result.compilation_tries = tries;
        assert!(submission_to_compile(Some(&result)));
    }
}

#[test]
fn submission_compilation_stops_at_three_tries() {
    let mut result = submission_result();
    for tries in [MAX_COMPILATION_TRIES, MAX_COMPILATION_TRIES + 1] {
        result.compilation_tries = tries;
        assert!(!submission_to_compile(Some(&result)));
    }
}

#[test]
fn finished_submission_compilation_is_not_retried() {
    let mut result = submission_result();
    for outcome in [CompilationOutcome::Ok, CompilationOutcome::Fail] {
        result.compilation_outcome = Some(outcome);
        result.compilation_tries = 0;
        assert!(!submission_to_compile(Some(&result)));
    }
}

#[test]
fn submission_evaluation_requires_successful_compilation() {
    let mut result = submission_result();
    assert!(!submission_to_evaluate(None));
    assert!(!submission_to_evaluate(Some(&result)));
    result.compilation_outcome = Some(CompilationOutcome::Fail);
    assert!(!submission_to_evaluate(Some(&result)));
}

#[test]
fn compiled_submission_is_evaluated_below_retry_limit() {
    let mut result = submission_result();
    result.compilation_outcome = Some(CompilationOutcome::Ok);
    for tries in 0..MAX_EVALUATION_TRIES {
        result.evaluation_tries = tries;
        assert!(submission_to_evaluate(Some(&result)));
    }
}

#[test]
fn submission_evaluation_stops_at_three_tries() {
    let mut result = submission_result();
    result.compilation_outcome = Some(CompilationOutcome::Ok);
    for tries in [MAX_EVALUATION_TRIES, MAX_EVALUATION_TRIES + 1] {
        result.evaluation_tries = tries;
        assert!(!submission_to_evaluate(Some(&result)));
    }
}

#[test]
fn evaluated_submission_is_not_evaluated_again() {
    let mut result = submission_result();
    result.compilation_outcome = Some(CompilationOutcome::Ok);
    result.set_evaluation_outcome();
    assert!(!submission_to_evaluate(Some(&result)));
}

#[test]
fn eligible_submission_needs_a_testcase_without_an_evaluation() {
    let mut result = submission_result();
    result.compilation_outcome = Some(CompilationOutcome::Ok);
    assert!(submission_to_evaluate_on_testcase(&result, 7, &[]));
    assert!(submission_to_evaluate_on_testcase(
        &result,
        7,
        &[evaluation(8)]
    ));
}

#[test]
fn evaluated_testcase_is_not_scheduled_again() {
    let mut result = submission_result();
    result.compilation_outcome = Some(CompilationOutcome::Ok);
    assert!(!submission_to_evaluate_on_testcase(
        &result,
        7,
        &[evaluation(7)]
    ));
}

#[test]
fn ineligible_submission_needs_no_testcase_evaluation() {
    let mut result = submission_result();
    assert!(!submission_to_evaluate_on_testcase(&result, 7, &[]));
    result.compilation_outcome = Some(CompilationOutcome::Ok);
    result.evaluation_tries = MAX_EVALUATION_TRIES;
    assert!(!submission_to_evaluate_on_testcase(&result, 7, &[]));
    result.evaluation_tries = 0;
    result.set_evaluation_outcome();
    assert!(!submission_to_evaluate_on_testcase(&result, 7, &[]));
}

#[test]
fn missing_user_test_result_needs_compilation() {
    assert!(user_test_to_compile(None));
}

#[test]
fn unfinished_user_test_compilation_is_retried_below_limit() {
    let mut result = user_test_result();
    for tries in 0..MAX_USER_TEST_COMPILATION_TRIES {
        result.compilation_tries = tries;
        assert!(user_test_to_compile(Some(&result)));
    }
}

#[test]
fn user_test_compilation_stops_at_three_tries() {
    let mut result = user_test_result();
    for tries in [
        MAX_USER_TEST_COMPILATION_TRIES,
        MAX_USER_TEST_COMPILATION_TRIES + 1,
    ] {
        result.compilation_tries = tries;
        assert!(!user_test_to_compile(Some(&result)));
    }
}

#[test]
fn finished_user_test_compilation_is_not_retried() {
    let mut result = user_test_result();
    for success in [true, false] {
        result.set_compilation_outcome(success);
        result.compilation_tries = 0;
        assert!(!user_test_to_compile(Some(&result)));
    }
}

#[test]
fn user_test_evaluation_requires_successful_compilation() {
    let mut result = user_test_result();
    assert!(!user_test_to_evaluate(None));
    assert!(!user_test_to_evaluate(Some(&result)));
    result.set_compilation_outcome(false);
    assert!(!user_test_to_evaluate(Some(&result)));
}

#[test]
fn compiled_user_test_is_evaluated_below_retry_limit() {
    let mut result = user_test_result();
    result.set_compilation_outcome(true);
    for tries in 0..MAX_USER_TEST_EVALUATION_TRIES {
        result.evaluation_tries = tries;
        assert!(user_test_to_evaluate(Some(&result)));
    }
}

#[test]
fn user_test_evaluation_stops_at_three_tries() {
    let mut result = user_test_result();
    result.set_compilation_outcome(true);
    for tries in [
        MAX_USER_TEST_EVALUATION_TRIES,
        MAX_USER_TEST_EVALUATION_TRIES + 1,
    ] {
        result.evaluation_tries = tries;
        assert!(!user_test_to_evaluate(Some(&result)));
    }
}

#[test]
fn evaluated_user_test_is_not_evaluated_again() {
    let mut result = user_test_result();
    result.set_compilation_outcome(true);
    result.set_evaluation_outcome();
    assert!(!user_test_to_evaluate(Some(&result)));
}
