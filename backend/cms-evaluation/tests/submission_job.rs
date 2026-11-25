//! The worker body one [`SubmissionInputs`] bundle becomes, for both submission
//! constructors, and the three ways a build is refused. Pure: no database, no
//! Python, no worker.

use std::collections::BTreeMap;

use chrono::NaiveDate;
use cms_db::{
    dataset_from_row, submission_from_row, testcase_from_row, DatasetId, DatasetRecord, DatasetRow,
    FileDigest, Submission, SubmissionId, SubmissionInputs, SubmissionResult, TestcaseRecord,
};
use cms_evaluation::{submission_job, SubmissionJobError};
use cms_proto::{Operation, OperationKind};
use serde_json::{json, Value};

const SUBMISSION_ID: i32 = 7;
const DATASET_ID: i32 = 11;
const TASK_TYPE: &str = "Batch";
const LANGUAGE: &str = "C++20 / g++";
const PARAMS: &str = r#"{"feedback_level":"full","limits":{"time":2.5,"memory":268435456},"cases":["alpha","beta"]}"#;

fn hex(value: u32) -> String {
    format!("{value:040x}")
}

fn digest(value: u32) -> FileDigest {
    hex(value).parse().expect("a valid digest")
}

fn digest_map(entries: &[(&str, u32)]) -> BTreeMap<String, FileDigest> {
    entries
        .iter()
        .map(|(name, value)| ((*name).to_owned(), digest(*value)))
        .collect()
}

fn testcase(id: i32, codename: &str, is_public: bool, input: u32, output: u32) -> TestcaseRecord {
    testcase_from_row(
        id,
        DATASET_ID,
        codename.to_owned(),
        is_public,
        &hex(input),
        &hex(output),
    )
    .expect("a valid testcase")
}

fn submission() -> Submission {
    let timestamp = NaiveDate::from_ymd_opt(2026, 1, 1)
        .and_then(|date| date.and_hms_opt(0, 0, 0))
        .expect("a valid fixture timestamp");
    Submission {
        record: submission_from_row(
            SubmissionId(SUBMISSION_ID),
            3,
            5,
            timestamp,
            Some(LANGUAGE.to_owned()),
            true,
        ),
        opaque_id: 99,
        comment: String::new(),
    }
}

fn dataset() -> DatasetRecord {
    dataset_from_row(DatasetRow {
        id: DatasetId(DATASET_ID),
        task_id: 3,
        task_type: TASK_TYPE.to_owned(),
        task_type_parameters: PARAMS.to_owned(),
        score_type: "Sum".to_owned(),
        score_type_parameters: "{}".to_owned(),
        time_limit: Some(2.5),
        memory_limit: Some(268_435_456),
        is_active: true,
    })
}

fn inputs() -> SubmissionInputs {
    SubmissionInputs {
        submission: submission(),
        dataset: dataset(),
        testcases: vec![
            testcase(1, "alpha", true, 0xa1, 0xa2),
            testcase(2, "beta", false, 0xb1, 0xb2),
        ],
        managers: digest_map(&[("checker", 0xc1), ("grader.cpp", 0xc2)]),
        files: digest_map(&[("solution.cpp", 0xd1)]),
        result: Some(SubmissionResult::new(
            SubmissionId(SUBMISSION_ID),
            DatasetId(DATASET_ID),
        )),
        executables: digest_map(&[("solution", 0xe1)]),
        languages: vec![LANGUAGE.to_owned(), "Java / JDK".to_owned()],
    }
}

fn operation(kind: OperationKind, codename: Option<&str>) -> Operation {
    Operation {
        kind,
        object_id: i64::from(SUBMISSION_ID),
        dataset_id: i64::from(DATASET_ID),
        testcase_codename: codename.map(str::to_owned),
        archive_sandbox: false,
    }
}

fn expected_params() -> Value {
    json!({
        "feedback_level": "full",
        "limits": {"time": 2.5, "memory": 268435456},
        "cases": ["alpha", "beta"]
    })
}

fn files_value() -> Value {
    json!({"solution.cpp": hex(0xd1)})
}

fn managers_value() -> Value {
    json!({"checker": hex(0xc1), "grader.cpp": hex(0xc2)})
}

fn executables_value() -> Value {
    json!({"solution": hex(0xe1)})
}

fn assert_identity(body: &Value, job_type: &str, op_type: &str) {
    assert_eq!(body["type"], json!(job_type));
    assert_eq!(body["task_type"], json!(TASK_TYPE));
    assert_eq!(body["task_type_parameters"], expected_params());
    assert_eq!(body["language"], json!(LANGUAGE));
    assert_eq!(body["multithreaded_sandbox"], json!(true));
    assert_eq!(body["archive_sandbox"], json!(false));
    assert_eq!(body["files"], files_value());
    assert_eq!(body["managers"], managers_value());
    assert_eq!(body["operation"]["type"], json!(op_type));
    assert_eq!(body["operation"]["object_id"], json!(SUBMISSION_ID));
    assert_eq!(body["operation"]["dataset_id"], json!(DATASET_ID));
    assert_eq!(body["operation"]["archive_sandbox"], json!(false));
    assert_eq!(body["shard"], Value::Null);
    assert_eq!(body["keep_sandbox"], json!(false));
    assert_eq!(body["plus"], Value::Null);
}

#[test]
fn compilation_body_writes_the_exact_compilation_shape() {
    let body = submission_job(&operation(OperationKind::Compilation, None), &inputs())
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
        &operation(OperationKind::Evaluation, Some("alpha")),
        &inputs(),
    )
    .expect("a valid submission evaluation");
    assert_identity(&body, "evaluation", "evaluate");
    assert_eq!(
        body["info"],
        json!("evaluate submission 7 on testcase alpha")
    );
    assert_eq!(body["executables"], executables_value());
    assert_eq!(body["input"], json!(hex(0xa1)));
    assert_eq!(body["output"], json!(hex(0xa2)));
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
        &operation(OperationKind::UserTestCompilation, None),
        &inputs(),
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
    let mut bundle = inputs();
    bundle.dataset.task_type_parameters = "{not json".to_owned();
    let error = submission_job(&operation(OperationKind::Compilation, None), &bundle)
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
    let error = submission_job(&op, &inputs()).expect_err("a scoped-out operation is refused");
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
    let mut op = operation(OperationKind::Compilation, None);
    op.object_id = 999;
    assert_build_refusal(op, "Object mismatch");
}

#[test]
fn an_operation_for_another_dataset_is_refused_by_the_constructor() {
    let mut op = operation(OperationKind::Compilation, None);
    op.dataset_id = 999;
    assert_build_refusal(op, "Dataset mismatch");
}
