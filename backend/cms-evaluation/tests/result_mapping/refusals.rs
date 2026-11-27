//! Named refusals for operations, codenames and produced digests.

use cms_db::SubmissionInputs;
use cms_evaluation::{map_result, worker_output, MapError};
use cms_proto::{Operation, OperationKind};
use serde_json::json;

use super::support::{compilation_body, evaluation_body, inputs, operation};

fn compile(inputs: &SubmissionInputs, operation: &Operation) -> Result<(), MapError> {
    let body = compilation_body(true);
    let output = worker_output(body.as_object().expect("an object body")).expect("a valid body");
    map_result(&output, operation, inputs).map(|_| ())
}

#[test]
fn wrong_object_and_dataset_ids_are_refused_by_name() {
    let inputs = inputs(None);
    let mut wrong_object = operation(OperationKind::Compilation, None, false);
    wrong_object.object_id += 1;
    assert_eq!(
        compile(&inputs, &wrong_object),
        Err(MapError::WrongObjectId {
            operation: 42,
            inputs: 41,
        })
    );

    let mut wrong_dataset = operation(OperationKind::Compilation, None, false);
    wrong_dataset.dataset_id += 1;
    assert_eq!(
        compile(&inputs, &wrong_dataset),
        Err(MapError::WrongDatasetId {
            operation: 10,
            inputs: 9,
        })
    );
}

#[test]
fn a_missing_testcase_codename_is_refused_by_name() {
    let inputs = inputs(None);
    let operation = operation(OperationKind::Evaluation, Some("absent"), false);
    let body = evaluation_body(true);
    let output = worker_output(body.as_object().expect("an object body")).expect("a valid body");
    assert_eq!(
        map_result(&output, &operation, &inputs),
        Err(MapError::MissingTestcase {
            codename: "absent".to_string()
        })
    );
}

#[test]
fn a_duplicate_testcase_codename_is_refused_by_name() {
    let mut inputs = inputs(None);
    let mut duplicate = inputs.testcases[1].clone();
    duplicate.id = 5;
    inputs.testcases.push(duplicate);
    let operation = operation(OperationKind::Evaluation, Some("alpha"), false);
    let body = evaluation_body(true);
    let output = worker_output(body.as_object().expect("an object body")).expect("a valid body");
    assert_eq!(
        map_result(&output, &operation, &inputs),
        Err(MapError::DuplicateTestcase {
            codename: "alpha".to_string()
        })
    );
}

#[test]
fn an_evaluation_without_a_codename_is_refused_by_name() {
    let inputs = inputs(None);
    let operation = operation(OperationKind::Evaluation, None, false);
    let body = evaluation_body(true);
    let output = worker_output(body.as_object().expect("an object body")).expect("a valid body");
    assert_eq!(
        map_result(&output, &operation, &inputs),
        Err(MapError::TestcaseRequired)
    );
}

#[test]
fn a_user_test_operation_is_refused_by_name() {
    let inputs = inputs(None);
    let operation = operation(OperationKind::UserTestCompilation, None, false);
    assert_eq!(
        compile(&inputs, &operation),
        Err(MapError::UnsupportedOperation {
            kind: "compile_test"
        })
    );
}

#[test]
fn a_malformed_executable_digest_is_refused_by_name() {
    let inputs: cms_db::SubmissionInputs = inputs(None);
    let mut body = compilation_body(true);
    body["executables"] = json!({"a.out": "not a digest"});
    let output = worker_output(body.as_object().expect("an object body")).expect("a valid body");
    let operation = operation(OperationKind::Compilation, None, false);
    match map_result(&output, &operation, &inputs) {
        Err(MapError::BadExecutableDigest { filename, .. }) => assert_eq!(filename, "a.out"),
        Err(other) => panic!("expected a named digest refusal, got {other:?}"),
        Ok(_) => panic!("a malformed executable digest must not map"),
    }
}
