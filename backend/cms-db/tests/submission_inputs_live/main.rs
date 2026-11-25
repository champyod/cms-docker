//! `submission_inputs` against a real server: one fixture carries every input,
//! and the refusals and absences are checked on their own.
//!
//! RUN: CMS_DB_TEST_URL=postgres://cmsuser:***@127.0.0.1:5432/cmsdb_test \
//!        cargo test -p cms-db --test submission_inputs_live

mod support;

use cms_db::{
    submission_inputs, DatasetId, JudgingError, SubmissionError, SubmissionId, SubmissionInputs,
};
use sqlx::postgres::PgConnection;

use support::{
    add_other_dataset, add_result, expected, expected_languages, file_digest, setup, DATASET,
    MISSING_DATASET, MISSING_SUBMISSION, OTHER_DATASET, PARTICIPATION, SUBMISSION, TASK,
};

/// Reads inputs for the standard pair, expecting both rows to exist.
async fn load_inputs(connection: &mut PgConnection) -> SubmissionInputs {
    submission_inputs(connection, SubmissionId(SUBMISSION), DatasetId(DATASET))
        .await
        .expect("reading the submission inputs")
        .expect("the submission and dataset both exist")
}

/// The submission and dataset records.
fn assert_submission_and_dataset(inputs: &SubmissionInputs) {
    assert_eq!(inputs.submission.record.id.0, SUBMISSION);
    assert_eq!(inputs.submission.record.task_id, TASK);
    assert_eq!(inputs.submission.record.participation_id, PARTICIPATION);
    assert_eq!(inputs.submission.comment, "a submission");
    assert_eq!(inputs.dataset.id.0, DATASET);
    assert_eq!(inputs.dataset.task_id, TASK);
    assert_eq!(inputs.dataset.task_type_parameters, "{}");
}

/// Both testcases, found by codename so the read's order does not matter.
fn assert_testcases(inputs: &SubmissionInputs) {
    assert_eq!(inputs.testcases.len(), 2);
    let one = inputs
        .testcases
        .iter()
        .find(|case| case.codename == "one")
        .expect("testcase one");
    assert_eq!(one.input, file_digest(3));
    assert_eq!(one.output, file_digest(4));
    let two = inputs
        .testcases
        .iter()
        .find(|case| case.codename == "two")
        .expect("testcase two");
    assert_eq!(two.input, file_digest(5));
    assert_eq!(two.output, file_digest(6));
}

/// The three filename-to-digest maps.
fn assert_maps(inputs: &SubmissionInputs) {
    assert_eq!(inputs.managers, expected(&[("manager", 1), ("checker", 2)]));
    assert_eq!(
        inputs.files,
        expected(&[("source.%l", 7), ("extra.txt", 8)])
    );
    assert_eq!(inputs.executables, expected(&[("a.out", 9), ("stub", 10)]));
}

/// The optional result and the exact contest languages.
fn assert_result_and_languages(inputs: &SubmissionInputs) {
    let result = inputs
        .result
        .as_ref()
        .expect("the fixture has a result row");
    assert_eq!(result.submission_id.0, SUBMISSION);
    assert_eq!(result.dataset_id.0, DATASET);
    assert_eq!(result.compilation_tries, 2);
    assert_eq!(inputs.languages, expected_languages());
}

#[tokio::test]
async fn a_full_fixture_loads_every_input() {
    let mut connection = setup().await;
    add_result(&mut connection).await;
    let inputs = load_inputs(&mut connection).await;
    assert_submission_and_dataset(&inputs);
    assert_testcases(&inputs);
    assert_maps(&inputs);
    assert_result_and_languages(&inputs);
}

#[tokio::test]
async fn a_fixture_without_a_result_has_no_result_or_executables() {
    let mut connection = setup().await;
    let inputs = load_inputs(&mut connection).await;
    assert!(inputs.result.is_none());
    assert!(inputs.executables.is_empty());
    assert_eq!(inputs.managers.len(), 2);
    assert_eq!(inputs.files.len(), 2);
    assert_eq!(inputs.testcases.len(), 2);
    assert_eq!(inputs.languages, expected_languages());
}

#[tokio::test]
async fn a_missing_submission_returns_none() {
    let mut connection = setup().await;
    let inputs = submission_inputs(
        &mut connection,
        SubmissionId(MISSING_SUBMISSION),
        DatasetId(DATASET),
    )
    .await
    .expect("an absent submission is not a failure");
    assert!(inputs.is_none());
}

#[tokio::test]
async fn a_missing_dataset_returns_none() {
    let mut connection = setup().await;
    let inputs = submission_inputs(
        &mut connection,
        SubmissionId(SUBMISSION),
        DatasetId(MISSING_DATASET),
    )
    .await
    .expect("an absent dataset is not a failure");
    assert!(inputs.is_none());
}

#[tokio::test]
async fn a_dataset_of_another_task_is_a_named_refusal() {
    let mut connection = setup().await;
    add_other_dataset(&mut connection).await;
    let error = submission_inputs(
        &mut connection,
        SubmissionId(SUBMISSION),
        DatasetId(OTHER_DATASET),
    )
    .await
    .expect_err("a dataset of another task is refused, not empty");
    assert!(matches!(
        error,
        JudgingError::Submission(SubmissionError::DatasetOfAnotherTask { .. })
    ));
}

#[tokio::test]
async fn contest_languages_are_scoped_to_the_submission() {
    let mut connection = setup().await;
    add_result(&mut connection).await;
    let inputs = load_inputs(&mut connection).await;
    assert_eq!(inputs.languages, expected_languages());
    assert!(!inputs.languages.contains(&"Rust".to_string()));
}
