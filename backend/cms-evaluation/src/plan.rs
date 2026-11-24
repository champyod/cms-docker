//! Per-dataset operation planners for submissions and user tests.

use chrono::NaiveDateTime;

use cms_db::{
    DatasetRecord, Evaluation, SubmissionRecord, SubmissionResult, TestcaseRecord, UserTest,
    UserTestResult,
};
use cms_proto::{
    Operation, OperationKind, PRIORITY_EXTRA_LOW, PRIORITY_HIGH, PRIORITY_LOW, PRIORITY_MEDIUM,
};

use crate::operation::{
    submission_to_compile, submission_to_evaluate, submission_to_evaluate_on_testcase,
    user_test_to_compile, user_test_to_evaluate,
};
use crate::PlannedOperation;

/// Plans the work one submission owes for one dataset, without database reads.
#[must_use]
pub fn submission_operations(
    submission: &SubmissionRecord,
    dataset: &DatasetRecord,
    testcases: &[TestcaseRecord],
    evaluations: &[Evaluation],
    result: Option<&SubmissionResult>,
    archive_sandbox: bool,
) -> Vec<PlannedOperation> {
    if submission_to_compile(result) {
        return submission_compilation(submission, dataset, result, archive_sandbox);
    }
    result.map_or_else(Vec::new, |result| {
        if submission_to_evaluate(Some(result)) {
            submission_evaluations(
                submission,
                dataset,
                testcases,
                evaluations,
                result,
                archive_sandbox,
            )
        } else {
            Vec::new()
        }
    })
}

fn submission_compilation(
    submission: &SubmissionRecord,
    dataset: &DatasetRecord,
    result: Option<&SubmissionResult>,
    archive_sandbox: bool,
) -> Vec<PlannedOperation> {
    let tries = result.map_or(0, |result| result.compilation_tries);
    let priority = queue_priority(dataset.is_active, tries, PRIORITY_HIGH, PRIORITY_MEDIUM);
    vec![planned(
        Operation {
            kind: OperationKind::Compilation,
            object_id: i64::from(submission.id.0),
            dataset_id: i64::from(dataset.id.0),
            testcase_codename: None,
            archive_sandbox,
        },
        priority,
        submission.timestamp,
    )]
}

fn submission_evaluations(
    submission: &SubmissionRecord,
    dataset: &DatasetRecord,
    testcases: &[TestcaseRecord],
    evaluations: &[Evaluation],
    result: &SubmissionResult,
    archive_sandbox: bool,
) -> Vec<PlannedOperation> {
    let priority = queue_priority(
        dataset.is_active,
        result.evaluation_tries,
        PRIORITY_MEDIUM,
        PRIORITY_LOW,
    );
    testcases
        .iter()
        .filter(|testcase| submission_to_evaluate_on_testcase(result, testcase.id, evaluations))
        .map(|testcase| {
            planned(
                Operation {
                    kind: OperationKind::Evaluation,
                    object_id: i64::from(submission.id.0),
                    dataset_id: i64::from(dataset.id.0),
                    testcase_codename: Some(testcase.codename.clone()),
                    archive_sandbox,
                },
                priority,
                submission.timestamp,
            )
        })
        .collect()
}

/// Plans the work one user test owes for one dataset, without database reads.
#[must_use]
pub fn user_test_operations(
    user_test: &UserTest,
    dataset: &DatasetRecord,
    result: Option<&UserTestResult>,
) -> Vec<PlannedOperation> {
    if user_test_to_compile(result) {
        return user_test_compilation(user_test, dataset, result);
    }
    result.map_or_else(Vec::new, |result| {
        if user_test_to_evaluate(Some(result)) {
            vec![user_test_evaluation(user_test, dataset, result)]
        } else {
            Vec::new()
        }
    })
}

fn user_test_evaluation(
    user_test: &UserTest,
    dataset: &DatasetRecord,
    result: &UserTestResult,
) -> PlannedOperation {
    let priority = queue_priority(
        dataset.is_active,
        result.evaluation_tries,
        PRIORITY_MEDIUM,
        PRIORITY_LOW,
    );
    planned(
        Operation {
            kind: OperationKind::UserTestEvaluation,
            object_id: i64::from(user_test.id),
            dataset_id: i64::from(dataset.id.0),
            testcase_codename: None,
            archive_sandbox: false,
        },
        priority,
        user_test.timestamp,
    )
}

fn user_test_compilation(
    user_test: &UserTest,
    dataset: &DatasetRecord,
    result: Option<&UserTestResult>,
) -> Vec<PlannedOperation> {
    let tries = result.map_or(0, |result| result.compilation_tries);
    let priority = queue_priority(dataset.is_active, tries, PRIORITY_HIGH, PRIORITY_MEDIUM);
    vec![planned(
        Operation {
            kind: OperationKind::UserTestCompilation,
            object_id: i64::from(user_test.id),
            dataset_id: i64::from(dataset.id.0),
            testcase_codename: None,
            archive_sandbox: false,
        },
        priority,
        user_test.timestamp,
    )]
}

fn queue_priority(is_active: bool, tries: i32, first_try: i32, retry: i32) -> i32 {
    if !is_active {
        PRIORITY_EXTRA_LOW
    } else if tries == 0 {
        first_try
    } else {
        retry
    }
}

fn planned(operation: Operation, priority: i32, timestamp: NaiveDateTime) -> PlannedOperation {
    PlannedOperation {
        operation,
        priority,
        timestamp,
    }
}

#[cfg(test)]
mod tests;
