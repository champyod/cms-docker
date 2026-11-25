//! The one valid submission bundle shared by the job-builder and runner tests.
//!
//! [`ValidFixture`] builds the exact [`SubmissionInputs`] and [`Operation`] the
//! worker body builder reads, plus the parsed values its shape assertions pin.
//! Keeping it here stops the runner tests growing a second copy of the bundle.

use std::collections::BTreeMap;

use chrono::NaiveDate;
use cms_db::{
    dataset_from_row, submission_from_row, testcase_from_row, DatasetId, DatasetRecord, DatasetRow,
    FileDigest, Submission, SubmissionId, SubmissionInputs, SubmissionResult, TestcaseRecord,
};
use cms_proto::{Operation, OperationKind};
use serde_json::{json, Value};

/// Builds the valid submission bundle, its operations and the values its body
/// assertions expect, for one fixed fixture.
pub struct ValidFixture;

impl ValidFixture {
    /// The submission id every fixture row is filed under.
    pub const SUBMISSION_ID: i32 = 7;
    /// The dataset id every fixture row is filed under.
    pub const DATASET_ID: i32 = 11;
    /// The task type the fixture names.
    pub const TASK_TYPE: &'static str = "Batch";
    /// The language the fixture's submission names.
    pub const LANGUAGE: &'static str = "C++20 / g++";
    /// The raw, valid `task_type_parameters` JSON the fixture carries.
    pub const PARAMS: &'static str = r#"{"feedback_level":"full","limits":{"time":2.5,"memory":268435456},"cases":["alpha","beta"]}"#;

    /// A forty-digit lowercase hex digest for `value`.
    pub fn hex(value: u32) -> String {
        format!("{value:040x}")
    }

    /// Parses one hex value into the digest type the bundle carries.
    pub fn digest(value: u32) -> FileDigest {
        Self::hex(value).parse().expect("a valid digest")
    }

    /// Builds a named digest map from `(filename, seed)` pairs.
    pub fn digest_map(entries: &[(&str, u32)]) -> BTreeMap<String, FileDigest> {
        entries
            .iter()
            .map(|(name, value)| ((*name).to_owned(), Self::digest(*value)))
            .collect()
    }

    /// One testcase row of the fixture dataset.
    pub fn testcase(
        id: i32,
        codename: &str,
        is_public: bool,
        input: u32,
        output: u32,
    ) -> TestcaseRecord {
        testcase_from_row(
            id,
            Self::DATASET_ID,
            codename.to_owned(),
            is_public,
            &Self::hex(input),
            &Self::hex(output),
        )
        .expect("a valid testcase")
    }

    /// The submission row the fixture is built around.
    pub fn submission() -> Submission {
        let timestamp = NaiveDate::from_ymd_opt(2026, 1, 1)
            .and_then(|date| date.and_hms_opt(0, 0, 0))
            .expect("a valid fixture timestamp");
        Submission {
            record: submission_from_row(
                SubmissionId(Self::SUBMISSION_ID),
                3,
                5,
                timestamp,
                Some(Self::LANGUAGE.to_owned()),
                true,
            ),
            opaque_id: 99,
            comment: String::new(),
        }
    }

    /// The active Batch dataset row of the fixture.
    pub fn dataset() -> DatasetRecord {
        dataset_from_row(DatasetRow {
            id: DatasetId(Self::DATASET_ID),
            task_id: 3,
            task_type: Self::TASK_TYPE.to_owned(),
            task_type_parameters: Self::PARAMS.to_owned(),
            score_type: "Sum".to_owned(),
            score_type_parameters: "{}".to_owned(),
            time_limit: Some(2.5),
            memory_limit: Some(268_435_456),
            is_active: true,
        })
    }

    /// A valid [`SubmissionInputs`] bundle with parseable task parameters.
    pub fn inputs() -> SubmissionInputs {
        SubmissionInputs {
            submission: Self::submission(),
            dataset: Self::dataset(),
            testcases: vec![
                Self::testcase(1, "alpha", true, 0xa1, 0xa2),
                Self::testcase(2, "beta", false, 0xb1, 0xb2),
            ],
            managers: Self::digest_map(&[("checker", 0xc1), ("grader.cpp", 0xc2)]),
            files: Self::digest_map(&[("solution.cpp", 0xd1)]),
            result: Some(SubmissionResult::new(
                SubmissionId(Self::SUBMISSION_ID),
                DatasetId(Self::DATASET_ID),
            )),
            executables: Self::digest_map(&[("solution", 0xe1)]),
            languages: vec![Self::LANGUAGE.to_owned(), "Java / JDK".to_owned()],
        }
    }

    /// The same bundle with malformed, non-JSON `task_type_parameters`.
    pub fn invalid_inputs() -> SubmissionInputs {
        let mut bundle = Self::inputs();
        bundle.dataset.task_type_parameters = "{not json".to_owned();
        bundle
    }

    /// An operation of `kind` on the fixture's submission and dataset.
    pub fn operation(kind: OperationKind, codename: Option<&str>) -> Operation {
        Operation {
            kind,
            object_id: i64::from(Self::SUBMISSION_ID),
            dataset_id: i64::from(Self::DATASET_ID),
            testcase_codename: codename.map(str::to_owned),
            archive_sandbox: false,
        }
    }

    /// The parsed `task_type_parameters` the body carries.
    pub fn expected_params() -> Value {
        json!({
            "feedback_level": "full",
            "limits": {"time": 2.5, "memory": 268435456},
            "cases": ["alpha", "beta"]
        })
    }

    /// The `files` map the body carries.
    pub fn files_value() -> Value {
        json!({"solution.cpp": Self::hex(0xd1)})
    }

    /// The `managers` map the body carries.
    pub fn managers_value() -> Value {
        json!({"checker": Self::hex(0xc1), "grader.cpp": Self::hex(0xc2)})
    }

    /// The `executables` map the body carries.
    pub fn executables_value() -> Value {
        json!({"solution": Self::hex(0xe1)})
    }
}
