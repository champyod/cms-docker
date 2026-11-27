//! Synthetic inputs, operations and worker bodies for the mapping tests.

use std::collections::BTreeMap;

use chrono::{DateTime, NaiveDateTime};
use cms_db::{
    dataset_from_row, submission_from_row, testcase_from_row, CompilationOutcome, DatasetId,
    DatasetRow, EvaluationOutcome, ResultRow, Submission, SubmissionId, SubmissionInputs,
    SubmissionResult, TestcaseRecord,
};
use cms_proto::{Operation, OperationKind};
use serde_json::{json, Value};

pub const SUBMISSION_ID: SubmissionId = SubmissionId(41);
pub const DATASET_ID: DatasetId = DatasetId(9);
pub const TESTCASE_ID: i32 = 3;
pub const OTHER_TESTCASE_ID: i32 = 4;
pub const DIGEST: &str = "0123456789abcdef0123456789abcdef01234567";
pub const OTHER_DIGEST: &str = "fedcba9876543210fedcba9876543210fedcba98";
pub const COMPILER_TEXT: &str = "compiler said";
pub const GRADER_TEXT: &str = "Output is correct";
const TIMESTAMP_SECONDS: i64 = 1_700_000_000;

/// The stored result the tests replace: every field is distinguishable.
pub fn prior_result() -> SubmissionResult {
    let mut result = SubmissionResult::new(SUBMISSION_ID, DATASET_ID);
    result.compilation_outcome = Some(CompilationOutcome::Ok);
    result.compilation_text = vec!["old compiler".to_string()];
    result.compilation_tries = 2;
    result.compilation_stdout = Some("old out".to_string());
    result.compilation_stderr = Some("old err".to_string());
    result.compilation_time = Some(9.0);
    result.compilation_wall_clock_time = Some(10.0);
    result.compilation_memory = Some(999);
    result.compilation_shard = Some(5);
    result.compilation_sandbox_paths = Some(vec!["old box".to_string()]);
    result.compilation_sandbox_digests = Some(vec![OTHER_DIGEST.to_string()]);
    result.evaluation_outcome = Some(EvaluationOutcome::Ok);
    result.evaluation_tries = 4;
    result.score = Some(12.5);
    result
}

/// The row shape the stored result above writes, spelled out as an oracle.
pub fn prior_row() -> ResultRow {
    ResultRow {
        submission_id: SUBMISSION_ID,
        dataset_id: DATASET_ID,
        compilation_outcome: Some(CompilationOutcome::Ok),
        compilation_text: vec!["old compiler".to_string()],
        compilation_tries: 2,
        compilation_stdout: Some("old out".to_string()),
        compilation_stderr: Some("old err".to_string()),
        compilation_time: Some(9.0),
        compilation_wall_clock_time: Some(10.0),
        compilation_memory: Some(999),
        compilation_shard: Some(5),
        compilation_sandbox_paths: Some(vec!["old box".to_string()]),
        compilation_sandbox_digests: Some(vec![OTHER_DIGEST.to_string()]),
        evaluation_outcome: Some(EvaluationOutcome::Ok),
        evaluation_tries: 4,
    }
}

/// The blank row a result write starts from when no result row exists yet.
pub fn blank_row() -> ResultRow {
    ResultRow {
        submission_id: SUBMISSION_ID,
        dataset_id: DATASET_ID,
        compilation_outcome: None,
        compilation_text: Vec::new(),
        compilation_tries: 0,
        compilation_stdout: None,
        compilation_stderr: None,
        compilation_time: None,
        compilation_wall_clock_time: None,
        compilation_memory: None,
        compilation_shard: None,
        compilation_sandbox_paths: None,
        compilation_sandbox_digests: None,
        evaluation_outcome: None,
        evaluation_tries: 0,
    }
}

/// Inputs whose testcases put `beta` first, so an untranslated codename shows.
pub fn inputs(result: Option<SubmissionResult>) -> SubmissionInputs {
    SubmissionInputs {
        submission: Submission {
            record: submission_from_row(
                SUBMISSION_ID,
                7,
                12,
                timestamp(),
                Some("cpp20".to_string()),
                true,
            ),
            opaque_id: 99,
            comment: String::new(),
        },
        dataset: dataset_from_row(DatasetRow {
            id: DATASET_ID,
            task_id: 7,
            task_type: "Batch".to_string(),
            task_type_parameters: "{}".to_string(),
            score_type: "Sum".to_string(),
            score_type_parameters: "{}".to_string(),
            time_limit: None,
            memory_limit: None,
            is_active: true,
        }),
        testcases: vec![
            testcase(OTHER_TESTCASE_ID, "beta"),
            testcase(TESTCASE_ID, "alpha"),
        ],
        managers: BTreeMap::new(),
        files: BTreeMap::new(),
        result,
        executables: BTreeMap::new(),
        languages: vec!["cpp20".to_string()],
    }
}

/// Inputs carrying one pre-existing executable, which may be the tombstone.
pub fn with_executable(mut inputs: SubmissionInputs, digest: &str) -> SubmissionInputs {
    inputs.executables.insert(
        "a.out".to_string(),
        digest.parse().expect("a valid fixture digest"),
    );
    inputs
}

/// The operation a fixture body answers.
pub fn operation(kind: OperationKind, codename: Option<&str>, archive: bool) -> Operation {
    Operation {
        kind,
        object_id: i64::from(SUBMISSION_ID.0),
        dataset_id: i64::from(DATASET_ID.0),
        testcase_codename: codename.map(str::to_string),
        archive_sandbox: archive,
    }
}

/// A compilation body with one executable and two measured sandboxes.
pub fn compilation_body(success: bool) -> Value {
    json!({
        "success": success,
        "compilation_success": true,
        "text": [COMPILER_TEXT],
        "sandboxes": ["box/one", "box/two"],
        "sandbox_digests": {"box/one": DIGEST, "box/two": OTHER_DIGEST},
        "executables": {"a.out": DIGEST},
        "plus": stats_value(false),
    })
}

/// An evaluation body with one outcome, two sandboxes and full measurements.
pub fn evaluation_body(success: bool) -> Value {
    json!({
        "success": success,
        "outcome": "1.0",
        "text": [GRADER_TEXT],
        "admin_text": "internal note",
        "sandboxes": ["box/one", "box/two"],
        "sandbox_digests": {"box/one": DIGEST, "box/two": OTHER_DIGEST},
        "plus": stats_value(false),
    })
}

pub fn stats_value(tombstone: bool) -> Value {
    let mut plus = json!({
        "execution_time": 0.5,
        "execution_wall_clock_time": 0.6,
        "execution_memory": 2048,
        "stdout": "out",
        "stderr": "err",
    });
    if tombstone {
        plus.as_object_mut()
            .expect("a JSON object")
            .insert("tombstone".to_string(), json!(true));
    }
    plus
}

pub fn with_tombstone(mut body: Value) -> Value {
    body.as_object_mut()
        .expect("a JSON object")
        .insert("plus".to_string(), stats_value(true));
    body
}

fn testcase(id: i32, codename: &str) -> TestcaseRecord {
    testcase_from_row(
        id,
        DATASET_ID.0,
        codename.to_string(),
        false,
        DIGEST,
        DIGEST,
    )
    .expect("fixture digests are valid")
}

fn timestamp() -> NaiveDateTime {
    DateTime::from_timestamp(TIMESTAMP_SECONDS, 0)
        .expect("fixture seconds are in range")
        .naive_utc()
}
