use cms_db::{CompilationOutcome, SubmissionResult};
use cms_proto::{
    Operation, OperationKind, PRIORITY_EXTRA_LOW, PRIORITY_HIGH, PRIORITY_LOW, PRIORITY_MEDIUM,
};

use crate::operation::{MAX_COMPILATION_TRIES, MAX_EVALUATION_TRIES};
use crate::support::{dataset, evaluation, submission, submission_result, testcases, timestamp};
use crate::PlannedOperation;

use crate::plan::submission_operations;

#[test]
fn submission_without_result_plans_one_compilation() {
    let submission = submission();
    let dataset = dataset(true);
    let testcases = testcases();

    let planned = submission_operations(&submission, &dataset, &testcases, &[], None, true);

    assert_eq!(
        planned,
        vec![PlannedOperation {
            operation: Operation {
                kind: OperationKind::Compilation,
                object_id: 11,
                dataset_id: 22,
                testcase_codename: None,
                archive_sandbox: true,
            },
            priority: PRIORITY_HIGH,
            timestamp: timestamp(),
        }]
    );
}

#[test]
fn unfinished_submission_compilation_is_retried_below_limit() {
    let submission = submission();
    let dataset = dataset(true);
    let testcases = testcases();
    for tries in 0..MAX_COMPILATION_TRIES {
        let result = uncompiled_result(tries);
        let planned =
            submission_operations(&submission, &dataset, &testcases, &[], Some(&result), false);
        assert_eq!(planned.len(), 1);
        assert_eq!(planned[0].operation.kind, OperationKind::Compilation);
        assert!(!planned[0].operation.archive_sandbox);
    }
}

#[test]
fn submission_compilation_stops_at_three_tries() {
    let submission = submission();
    let dataset = dataset(true);
    let testcases = testcases();
    for tries in [MAX_COMPILATION_TRIES, MAX_COMPILATION_TRIES + 1] {
        let result = uncompiled_result(tries);
        assert!(submission_operations(
            &submission,
            &dataset,
            &testcases,
            &[],
            Some(&result),
            false
        )
        .is_empty());
    }
}

#[test]
fn finished_submission_compilation_is_not_replanned_as_compilation() {
    let submission = submission();
    let dataset = dataset(true);
    let testcases = testcases();
    let mut result = submission_result();
    result.compilation_outcome = Some(CompilationOutcome::Fail);
    assert!(
        submission_operations(&submission, &dataset, &testcases, &[], Some(&result), false)
            .is_empty()
    );

    result.compilation_outcome = Some(CompilationOutcome::Ok);
    let planned =
        submission_operations(&submission, &dataset, &testcases, &[], Some(&result), false);
    assert!(!planned.is_empty());
    assert!(planned
        .iter()
        .all(|item| item.operation.kind == OperationKind::Evaluation));
}

#[test]
fn submission_compilation_priorities_follow_activity_and_retries() {
    let submission = submission();
    let testcases = testcases();
    let cases = [
        (true, None, PRIORITY_HIGH),
        (true, Some(0), PRIORITY_HIGH),
        (true, Some(1), PRIORITY_MEDIUM),
        (false, None, PRIORITY_EXTRA_LOW),
        (false, Some(1), PRIORITY_EXTRA_LOW),
    ];
    for (is_active, tries, priority) in cases {
        let dataset = dataset(is_active);
        let result = tries.map(uncompiled_result);
        let planned = submission_operations(
            &submission,
            &dataset,
            &testcases,
            &[],
            result.as_ref(),
            false,
        );
        assert_eq!(planned[0].priority, priority);
    }
}

#[test]
fn compiled_submission_plans_every_testcase_in_input_order() {
    let submission = submission();
    let dataset = dataset(true);
    let testcases = testcases();
    let result = compiled_result(0);

    let planned =
        submission_operations(&submission, &dataset, &testcases, &[], Some(&result), true);

    assert_eq!(codenames(&planned), ["gamma", "alpha", "beta"]);
    assert!(planned.iter().all(|item| {
        item.operation.kind == OperationKind::Evaluation
            && item.operation.object_id == 11
            && item.operation.dataset_id == 22
            && item.operation.archive_sandbox
            && item.priority == PRIORITY_MEDIUM
            && item.timestamp == timestamp()
    }));
}

#[test]
fn submission_evaluations_exclude_completed_testcases_in_input_order() {
    let submission = submission();
    let dataset = dataset(true);
    let testcases = testcases();
    let result = compiled_result(0);

    let planned = submission_operations(
        &submission,
        &dataset,
        &testcases,
        &[evaluation(10)],
        Some(&result),
        false,
    );

    assert_eq!(codenames(&planned), ["gamma", "beta"]);
    assert!(planned.iter().all(|item| !item.operation.archive_sandbox));
}

#[test]
fn submission_evaluation_stops_at_three_tries() {
    let submission = submission();
    let dataset = dataset(true);
    let testcases = testcases();
    for tries in [MAX_EVALUATION_TRIES, MAX_EVALUATION_TRIES + 1] {
        let result = compiled_result(tries);
        assert!(submission_operations(
            &submission,
            &dataset,
            &testcases,
            &[],
            Some(&result),
            false
        )
        .is_empty());
    }
}

#[test]
fn evaluated_submission_has_no_operations() {
    let submission = submission();
    let dataset = dataset(true);
    let testcases = testcases();
    let mut result = compiled_result(0);
    result.set_evaluation_outcome();
    assert!(
        submission_operations(&submission, &dataset, &testcases, &[], Some(&result), false)
            .is_empty()
    );
}

#[test]
fn submission_evaluation_priorities_follow_activity_and_retries() {
    let submission = submission();
    let testcases = testcases();
    let cases = [
        (true, 0, PRIORITY_MEDIUM),
        (true, 1, PRIORITY_LOW),
        (false, 0, PRIORITY_EXTRA_LOW),
        (false, 1, PRIORITY_EXTRA_LOW),
    ];
    for (is_active, tries, priority) in cases {
        let dataset = dataset(is_active);
        let result = compiled_result(tries);
        let planned =
            submission_operations(&submission, &dataset, &testcases, &[], Some(&result), false);
        assert!(planned.iter().all(|item| item.priority == priority));
    }
}

fn uncompiled_result(tries: i32) -> SubmissionResult {
    let mut result = submission_result();
    result.compilation_tries = tries;
    result
}

fn compiled_result(tries: i32) -> SubmissionResult {
    let mut result = submission_result();
    result.compilation_outcome = Some(CompilationOutcome::Ok);
    result.evaluation_tries = tries;
    result
}

fn codenames(planned: &[PlannedOperation]) -> Vec<&str> {
    planned
        .iter()
        .map(|item| {
            item.operation
                .testcase_codename
                .as_deref()
                .unwrap_or_default()
        })
        .collect()
}
