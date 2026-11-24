use cms_db::UserTestResult;
use cms_proto::{
    Operation, OperationKind, PRIORITY_EXTRA_LOW, PRIORITY_HIGH, PRIORITY_LOW, PRIORITY_MEDIUM,
};

use crate::operation::{MAX_USER_TEST_COMPILATION_TRIES, MAX_USER_TEST_EVALUATION_TRIES};
use crate::plan::user_test_operations;
use crate::support::{dataset, user_test, user_test_result, user_test_timestamp};
use crate::PlannedOperation;

#[test]
fn user_test_without_result_plans_one_compilation() {
    let user_test = user_test();
    let dataset = dataset(true);

    let planned = user_test_operations(&user_test, &dataset, None);

    assert_eq!(
        planned,
        vec![PlannedOperation {
            operation: Operation {
                kind: OperationKind::UserTestCompilation,
                object_id: 33,
                dataset_id: 22,
                testcase_codename: None,
                archive_sandbox: false,
            },
            priority: PRIORITY_HIGH,
            timestamp: user_test_timestamp(),
        }]
    );
}

#[test]
fn unfinished_user_test_compilation_is_retried_below_limit() {
    let user_test = user_test();
    let dataset = dataset(true);
    for tries in 0..MAX_USER_TEST_COMPILATION_TRIES {
        let result = uncompiled_user_result(tries);
        let planned = user_test_operations(&user_test, &dataset, Some(&result));
        assert_eq!(planned.len(), 1);
        assert_eq!(
            planned[0].operation.kind,
            OperationKind::UserTestCompilation
        );
        assert!(!planned[0].operation.archive_sandbox);
    }
}

#[test]
fn user_test_compilation_stops_at_three_tries() {
    let user_test = user_test();
    let dataset = dataset(true);
    for tries in [
        MAX_USER_TEST_COMPILATION_TRIES,
        MAX_USER_TEST_COMPILATION_TRIES + 1,
    ] {
        let result = uncompiled_user_result(tries);
        assert!(user_test_operations(&user_test, &dataset, Some(&result)).is_empty());
    }
}

#[test]
fn finished_user_test_compilation_is_not_replanned_as_compilation() {
    let user_test = user_test();
    let dataset = dataset(true);
    let mut result = user_test_result();
    result.set_compilation_outcome(false);
    assert!(user_test_operations(&user_test, &dataset, Some(&result)).is_empty());

    result.set_compilation_outcome(true);
    let planned = user_test_operations(&user_test, &dataset, Some(&result));
    assert_eq!(planned.len(), 1);
    assert_eq!(planned[0].operation.kind, OperationKind::UserTestEvaluation);
}

#[test]
fn user_test_compilation_priorities_follow_activity_and_retries() {
    let user_test = user_test();
    let cases = [
        (true, None, PRIORITY_HIGH),
        (true, Some(0), PRIORITY_HIGH),
        (true, Some(1), PRIORITY_MEDIUM),
        (false, None, PRIORITY_EXTRA_LOW),
        (false, Some(1), PRIORITY_EXTRA_LOW),
    ];
    for (is_active, tries, priority) in cases {
        let dataset = dataset(is_active);
        let result = tries.map(uncompiled_user_result);
        let planned = user_test_operations(&user_test, &dataset, result.as_ref());
        assert_eq!(planned[0].priority, priority);
    }
}

#[test]
fn compiled_user_test_plans_one_evaluation() {
    let user_test = user_test();
    let dataset = dataset(true);
    let result = compiled_user_result(0);

    let planned = user_test_operations(&user_test, &dataset, Some(&result));

    assert_eq!(
        planned,
        vec![PlannedOperation {
            operation: Operation {
                kind: OperationKind::UserTestEvaluation,
                object_id: 33,
                dataset_id: 22,
                testcase_codename: None,
                archive_sandbox: false,
            },
            priority: PRIORITY_MEDIUM,
            timestamp: user_test_timestamp(),
        }]
    );
}

#[test]
fn user_test_evaluation_stops_at_three_tries() {
    let user_test = user_test();
    let dataset = dataset(true);
    for tries in [
        MAX_USER_TEST_EVALUATION_TRIES,
        MAX_USER_TEST_EVALUATION_TRIES + 1,
    ] {
        let result = compiled_user_result(tries);
        assert!(user_test_operations(&user_test, &dataset, Some(&result)).is_empty());
    }
}

#[test]
fn evaluated_user_test_has_no_operations() {
    let user_test = user_test();
    let dataset = dataset(true);
    let mut result = compiled_user_result(0);
    result.set_evaluation_outcome();
    assert!(user_test_operations(&user_test, &dataset, Some(&result)).is_empty());
}

#[test]
fn user_test_evaluation_priorities_follow_activity_and_retries() {
    let user_test = user_test();
    let cases = [
        (true, 0, PRIORITY_MEDIUM),
        (true, 1, PRIORITY_LOW),
        (false, 0, PRIORITY_EXTRA_LOW),
        (false, 1, PRIORITY_EXTRA_LOW),
    ];
    for (is_active, tries, priority) in cases {
        let dataset = dataset(is_active);
        let result = compiled_user_result(tries);
        let planned = user_test_operations(&user_test, &dataset, Some(&result));
        assert_eq!(planned[0].priority, priority);
    }
}

fn uncompiled_user_result(tries: i32) -> UserTestResult {
    let mut result = user_test_result();
    result.compilation_tries = tries;
    result
}

fn compiled_user_result(tries: i32) -> UserTestResult {
    let mut result = user_test_result();
    result.set_compilation_outcome(true);
    result.evaluation_tries = tries;
    result
}
