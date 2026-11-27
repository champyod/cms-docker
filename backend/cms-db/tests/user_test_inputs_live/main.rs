//! `user_test_inputs` against a real server: one fixture carries every input,
//! and the named refusals are checked on their own.
//!
//! RUN: CMS_DB_TEST_URL=postgres://cmsuser:.../cmsdb_test \
//!        cargo test -p cms-db --test user_test_inputs_live

mod support;

use cms_db::{user_test_inputs, DatasetId, UserTestInputs, UserTestInputsError};
use sqlx::postgres::PgConnection;

use support::{
    add_result, expected, expected_languages, file_digest, setup, DATASET, MISSING_DATASET,
    MISSING_USER_TEST, PARTICIPATION, TASK, USER_TEST,
};

/// Reads inputs for the standard pair, expecting both rows to exist.
async fn load_inputs(connection: &mut PgConnection) -> UserTestInputs {
    user_test_inputs(connection, USER_TEST, DatasetId(DATASET))
        .await
        .expect("reading the user test inputs")
}

/// The user test and dataset records.
fn assert_records(inputs: &UserTestInputs) {
    assert_eq!(inputs.user_test.id, USER_TEST);
    assert_eq!(inputs.user_test.participation_id, PARTICIPATION);
    assert_eq!(inputs.user_test.task_id, TASK);
    assert_eq!(inputs.user_test.language.as_deref(), Some("C++17"));
    assert_eq!(inputs.user_test.input, file_digest(1));
    assert_eq!(inputs.dataset.id.0, DATASET);
    assert_eq!(inputs.dataset.task_id, TASK);
    assert_eq!(inputs.dataset.task_type_parameters, "{}");
    assert_eq!(inputs.dataset.time_limit, Some(2.5));
    assert_eq!(inputs.dataset.memory_limit, Some(268_435_456));
}

/// The four filename-to-digest maps and the exact contest languages.
fn assert_maps(inputs: &UserTestInputs) {
    assert_eq!(
        inputs.managers,
        expected(&[("grader.%l", 2), ("checker", 3)])
    );
    assert_eq!(inputs.user_test_managers, expected(&[("own.cpp", 5)]));
    assert_eq!(inputs.files, expected(&[("source.cpp", 4)]));
    assert_eq!(inputs.executables, expected(&[("a.out", 6), ("stub", 7)]));
    assert_eq!(inputs.languages, expected_languages());
}

#[tokio::test]
async fn a_full_fixture_loads_every_user_test_input() {
    let mut connection = setup().await;
    add_result(&mut connection).await;
    let inputs = load_inputs(&mut connection).await;
    assert_records(&inputs);
    assert_maps(&inputs);
}

#[tokio::test]
async fn a_fixture_without_a_result_has_no_executables() {
    let mut connection = setup().await;
    let inputs = load_inputs(&mut connection).await;
    assert!(inputs.executables.is_empty());
    assert_eq!(inputs.managers.len(), 2);
    assert_eq!(inputs.user_test_managers.len(), 1);
    assert_eq!(inputs.files.len(), 1);
    assert_eq!(inputs.languages, expected_languages());
}

#[tokio::test]
async fn a_missing_user_test_is_refused_by_name() {
    let mut connection = setup().await;
    let error = user_test_inputs(&mut connection, MISSING_USER_TEST, DatasetId(DATASET))
        .await
        .expect_err("an absent user test is refused, not defaulted");
    match &error {
        UserTestInputsError::MissingUserTest(id) => assert_eq!(*id, MISSING_USER_TEST),
        other => panic!("expected MissingUserTest, got {other:?}"),
    }
    assert!(error.to_string().contains("999"));
}

#[tokio::test]
async fn a_missing_dataset_is_refused_by_name() {
    let mut connection = setup().await;
    let error = user_test_inputs(&mut connection, USER_TEST, DatasetId(MISSING_DATASET))
        .await
        .expect_err("an absent dataset is refused, not defaulted");
    match &error {
        UserTestInputsError::MissingDataset(id) => assert_eq!(*id, MISSING_DATASET),
        other => panic!("expected MissingDataset, got {other:?}"),
    }
    assert!(error.to_string().contains("998"));
}

#[tokio::test]
async fn contest_languages_are_scoped_to_the_user_test() {
    let mut connection = setup().await;
    let inputs = load_inputs(&mut connection).await;
    assert_eq!(inputs.languages, expected_languages());
    assert!(!inputs.languages.contains(&"Rust".to_string()));
}
