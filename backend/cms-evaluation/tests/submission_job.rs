//! The worker body one [`SubmissionInputs`] bundle becomes, for both submission
//! constructors, and the three ways a build is refused. Pure: no database, no
//! Python, no worker.

#[path = "runner/support.rs"]
pub mod support;

use cms_evaluation::{submission_job, SubmissionJobError};
use cms_proto::{Operation, OperationKind};
use serde_json::{json, Value};

use crate::support::ValidFixture;

fn assert_identity(body: &Value, job_type: &str, op_type: &str) {
    assert_eq!(body["type"], json!(job_type));
    assert_eq!(body["task_type"], json!(ValidFixture::TASK_TYPE));
    assert_eq!(
        body["task_type_parameters"],
        ValidFixture::expected_params()
    );
    assert_eq!(body["language"], json!(ValidFixture::LANGUAGE));
    assert_eq!(body["multithreaded_sandbox"], json!(true));
    assert_eq!(body["archive_sandbox"], json!(false));
    assert_eq!(body["files"], ValidFixture::files_value());
    assert_eq!(body["managers"], ValidFixture::managers_value());
    assert_eq!(body["operation"]["type"], json!(op_type));
    assert_eq!(
        body["operation"]["object_id"],
        json!(ValidFixture::SUBMISSION_ID)
    );
    assert_eq!(
        body["operation"]["dataset_id"],
        json!(ValidFixture::DATASET_ID)
    );
    assert_eq!(body["operation"]["archive_sandbox"], json!(false));
    assert_eq!(body["shard"], Value::Null);
    assert_eq!(body["keep_sandbox"], json!(false));
    assert_eq!(body["plus"], Value::Null);
}

#[test]
fn compilation_body_writes_the_exact_compilation_shape() {
    let body = submission_job(
        &ValidFixture::operation(OperationKind::Compilation, None),
        &ValidFixture::inputs(),
    )
    .expect("a valid submission compilation");
    assert_identity(&body, "compilation", "compile");
    assert_eq!(body["info"], json!("compile submission 7"));
    assert_eq!(body["executables"], json!({}));
    assert_eq!(body["compilation_success"], Value::Null);
    assert_eq!(body["operation"]["testcase_codename"], Value::Null);
}

#[test]
fn evaluation_body_writes_the_exact_evaluation_shape() {
    let body = submission_job(
        &ValidFixture::operation(OperationKind::Evaluation, Some("alpha")),
        &ValidFixture::inputs(),
    )
    .expect("a valid submission evaluation");
    assert_identity(&body, "evaluation", "evaluate");
    assert_eq!(
        body["info"],
        json!("evaluate submission 7 on testcase alpha")
    );
    assert_eq!(body["executables"], ValidFixture::executables_value());
    assert_eq!(body["input"], json!(ValidFixture::hex(0xa1)));
    assert_eq!(body["output"], json!(ValidFixture::hex(0xa2)));
    assert_eq!(body["time_limit"], json!(2.5));
    assert_eq!(body["memory_limit"], json!(268_435_456i64));
    assert_eq!(body["only_execution"], json!(false));
    assert_eq!(body["get_output"], json!(false));
    assert_eq!(body["outcome"], Value::Null);
    assert_eq!(body["user_output"], Value::Null);
    assert_eq!(body["operation"]["testcase_codename"], json!("alpha"));
}

#[test]
fn user_test_compilation_is_refused_by_name() {
    let error = submission_job(
        &ValidFixture::operation(OperationKind::UserTestCompilation, None),
        &ValidFixture::inputs(),
    )
    .expect_err("a user-test kind is refused");
    match &error {
        SubmissionJobError::UnsupportedOperation { kind } => {
            assert_eq!(*kind, OperationKind::UserTestCompilation);
        }
        other => panic!("expected UnsupportedOperation, got {other:?}"),
    }
    assert!(error.to_string().contains("UserTestCompilation"));
}

#[test]
fn malformed_task_type_parameters_carries_the_parse_source() {
    let mut bundle = ValidFixture::inputs();
    bundle.dataset.task_type_parameters = "{not json".to_owned();
    let error = submission_job(
        &ValidFixture::operation(OperationKind::Compilation, None),
        &bundle,
    )
    .expect_err("malformed parameters are refused");
    match &error {
        SubmissionJobError::MalformedDatasetParameters { source } => {
            assert!(!source.to_string().is_empty());
        }
        other => panic!("expected MalformedDatasetParameters, got {other:?}"),
    }
    assert!(std::error::Error::source(&error).is_some());
}

fn assert_build_refusal(op: Operation, expected: &str) {
    let error = submission_job(&op, &ValidFixture::inputs())
        .expect_err("a scoped-out operation is refused");
    assert!(
        matches!(&error, SubmissionJobError::Build { .. }),
        "expected a Build refusal, got {error:?}"
    );
    assert!(
        error.to_string().contains(expected),
        "constructor refusal did not name {expected}: {error}"
    );
}

#[test]
fn an_operation_for_another_object_is_refused_by_the_constructor() {
    let mut op = ValidFixture::operation(OperationKind::Compilation, None);
    op.object_id = 999;
    assert_build_refusal(op, "Object mismatch");
}

#[test]
fn an_operation_for_another_dataset_is_refused_by_the_constructor() {
    let mut op = ValidFixture::operation(OperationKind::Compilation, None);
    op.dataset_id = 999;
    assert_build_refusal(op, "Dataset mismatch");
}
