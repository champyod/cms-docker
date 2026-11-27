//! The worker body one [`UserTestInputs`] bundle becomes, for both user-test
//! constructors, and the refusals that keep a wrong input from being defaulted.
//! Pure: no database, no Python, no worker.

mod support;

use cms_evaluation::{user_test_job, UserTestJobError};
use cms_proto::OperationKind;

use support::ValidFixture;

#[test]
fn compilation_body_is_the_exact_user_test_shape() {
    let body = user_test_job(
        &ValidFixture::operation(OperationKind::UserTestCompilation),
        &ValidFixture::inputs(),
    )
    .expect("a valid user test compilation");
    assert_eq!(body, ValidFixture::compilation_body());
}

#[test]
fn evaluation_body_is_the_exact_user_test_shape() {
    let body = user_test_job(
        &ValidFixture::operation(OperationKind::UserTestEvaluation),
        &ValidFixture::inputs(),
    )
    .expect("a valid user test evaluation");
    assert_eq!(body, ValidFixture::evaluation_body());
}

#[test]
fn a_submission_kind_is_refused_by_name() {
    let error = user_test_job(
        &ValidFixture::operation(OperationKind::Compilation),
        &ValidFixture::inputs(),
    )
    .expect_err("a submission kind is refused");
    match &error {
        UserTestJobError::UnsupportedOperation { kind } => {
            assert_eq!(*kind, OperationKind::Compilation);
        }
        other => panic!("expected UnsupportedOperation, got {other:?}"),
    }
    assert!(error.to_string().contains("Compilation"));
}

#[test]
fn malformed_task_type_parameters_carries_the_parse_source() {
    let mut bundle = ValidFixture::inputs();
    bundle.dataset.task_type_parameters = "{not json".to_owned();
    let error = user_test_job(
        &ValidFixture::operation(OperationKind::UserTestEvaluation),
        &bundle,
    )
    .expect_err("malformed parameters are refused");
    match &error {
        UserTestJobError::MalformedDatasetParameters { source } => {
            assert!(!source.to_string().is_empty());
        }
        other => panic!("expected MalformedDatasetParameters, got {other:?}"),
    }
    assert!(std::error::Error::source(&error).is_some());
}

#[test]
fn an_unknown_task_type_is_refused_by_name() {
    let mut bundle = ValidFixture::inputs();
    bundle.dataset.task_type = "NoSuchTaskType".to_owned();
    let error = user_test_job(
        &ValidFixture::operation(OperationKind::UserTestEvaluation),
        &bundle,
    )
    .expect_err("an unimplemented task type is refused");
    match &error {
        UserTestJobError::UnknownTaskType { source } => {
            assert!(source.to_string().contains("NoSuchTaskType"));
        }
        other => panic!("expected UnknownTaskType, got {other:?}"),
    }
}

#[test]
fn a_language_the_lookup_does_not_know_is_refused_by_name() {
    let mut bundle = ValidFixture::inputs();
    bundle.user_test.language = Some("No Such Language".to_owned());
    let error = user_test_job(
        &ValidFixture::operation(OperationKind::UserTestEvaluation),
        &bundle,
    )
    .expect_err("an unknown language is refused by the constructor");
    assert!(
        matches!(&error, UserTestJobError::Build { .. }),
        "expected a Build refusal, got {error:?}"
    );
    assert!(
        error.to_string().contains("No Such Language"),
        "the refusal did not name the language: {error}"
    );
}

fn assert_build_refusal(op: cms_proto::Operation, expected: &str) {
    let error =
        user_test_job(&op, &ValidFixture::inputs()).expect_err("a scoped-out operation is refused");
    assert!(
        matches!(&error, UserTestJobError::Build { .. }),
        "expected a Build refusal, got {error:?}"
    );
    assert!(
        error.to_string().contains(expected),
        "constructor refusal did not name {expected}: {error}"
    );
}

#[test]
fn an_operation_for_another_object_is_refused_by_the_constructor() {
    let mut op = ValidFixture::operation(OperationKind::UserTestEvaluation);
    op.object_id = 999;
    assert_build_refusal(op, "Object mismatch");
}

#[test]
fn an_operation_for_another_dataset_is_refused_by_the_constructor() {
    let mut op = ValidFixture::operation(OperationKind::UserTestEvaluation);
    op.dataset_id = 999;
    assert_build_refusal(op, "Dataset mismatch");
}
