//! The one valid user-test bundle shared by the builder tests.
//!
//! [`ValidFixture`] builds the exact [`UserTestInputs`] and [`Operation`] the
//! worker body builder reads, plus the full bodies its shape assertions pin.
//! Keeping it here stops the tests growing a second copy of the bundle.

use std::collections::BTreeMap;

use chrono::NaiveDate;
use cms_db::{dataset_from_row, DatasetId, DatasetRecord, DatasetRow, FileDigest, UserTestInputs};
use cms_proto::{Operation, OperationKind};
use serde_json::{json, Value};

/// Builds the valid user-test bundle, its operations and its pinned bodies.
pub struct ValidFixture;

impl ValidFixture {
    /// The user test id every fixture row is filed under.
    pub const USER_TEST_ID: i32 = 7;
    /// The dataset id every fixture row is filed under.
    pub const DATASET_ID: i32 = 11;
    /// The task id the fixture names.
    pub const TASK_ID: i32 = 5;
    /// The participation the fixture names.
    pub const PARTICIPATION_ID: i32 = 3;
    /// The Batch task type the fixture names.
    pub const TASK_TYPE: &'static str = "Batch";
    /// The language the fixture's user test names.
    pub const LANGUAGE: &'static str = "C++20 / g++";
    /// The raw, valid three-parameter Batch configuration the dataset carries.
    pub const PARAMS: &'static str = r#"["alone", ["", ""], "diff"]"#;

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

    /// The user-test row the fixture is built around.
    pub fn user_test_row() -> cms_db::UserTest {
        let timestamp = NaiveDate::from_ymd_opt(2026, 1, 1)
            .and_then(|date| date.and_hms_opt(0, 0, 0))
            .expect("a valid fixture timestamp");
        cms_db::UserTest {
            id: Self::USER_TEST_ID,
            participation_id: Self::PARTICIPATION_ID,
            task_id: Self::TASK_ID,
            timestamp,
            language: Some(Self::LANGUAGE.to_owned()),
            input: Self::digest(0xe1),
        }
    }

    /// The active Batch dataset row of the fixture.
    pub fn dataset() -> DatasetRecord {
        dataset_from_row(DatasetRow {
            id: DatasetId(Self::DATASET_ID),
            task_id: Self::TASK_ID,
            task_type: Self::TASK_TYPE.to_owned(),
            task_type_parameters: Self::PARAMS.to_owned(),
            score_type: "Sum".to_owned(),
            score_type_parameters: "0".to_owned(),
            time_limit: Some(2.5),
            memory_limit: Some(268_435_456),
            is_active: true,
        })
    }

    /// A valid [`UserTestInputs`] bundle with parseable task parameters.
    pub fn inputs() -> UserTestInputs {
        UserTestInputs {
            user_test: Self::user_test_row(),
            dataset: Self::dataset(),
            managers: Self::digest_map(&[("grader.h", 0xc1)]),
            user_test_managers: Self::digest_map(&[("own.cpp", 0xb1)]),
            files: Self::digest_map(&[("ut.cpp", 0xa1)]),
            executables: Self::digest_map(&[("ut", 0xd1)]),
            languages: vec![Self::LANGUAGE.to_owned(), "Java / JDK".to_owned()],
        }
    }

    /// An operation of `kind` on the fixture's user test and dataset.
    pub fn operation(kind: OperationKind) -> Operation {
        Operation {
            kind,
            object_id: i64::from(Self::USER_TEST_ID),
            dataset_id: i64::from(Self::DATASET_ID),
            testcase_codename: None,
            archive_sandbox: false,
        }
    }

    /// The operation object every pinned body carries.
    pub fn operation_value(kind: &str) -> Value {
        json!({
            "type": kind,
            "object_id": Self::USER_TEST_ID,
            "dataset_id": Self::DATASET_ID,
            "testcase_codename": Value::Null,
            "archive_sandbox": false,
        })
    }

    /// The fields shared by the two pinned bodies.
    pub fn shared(operation_type: &str) -> Value {
        json!({
            "operation": Self::operation_value(operation_type),
            "task_type": Self::TASK_TYPE,
            "task_type_parameters": Self::expected_params(),
            "language": Self::LANGUAGE,
            "multithreaded_sandbox": true,
            "archive_sandbox": false,
            "files": json!({"ut.cpp": Self::hex(0xa1)}),
        })
    }

    /// The parsed `task_type_parameters` both bodies carry.
    pub fn expected_params() -> Value {
        json!(["alone", ["", ""], "diff"])
    }

    /// The exact compilation body the reference sends for this fixture.
    pub fn compilation_body() -> Value {
        let mut body = Self::shared("compile_test");
        let object = body.as_object_mut().expect("a shared object");
        object.insert("type".to_owned(), json!("compilation"));
        object.insert(
            "managers".to_owned(),
            json!({"own.cpp": Self::hex(0xb1), "grader.h": Self::hex(0xc1)}),
        );
        object.insert("info".to_owned(), json!("compile user test 7"));
        object.insert("executables".to_owned(), json!({}));
        object.insert("compilation_success".to_owned(), Value::Null);
        Self::add_worker_defaults(object);
        body
    }

    /// The exact evaluation body the reference sends for this fixture.
    pub fn evaluation_body() -> Value {
        let mut body = Self::shared("evaluate_test");
        let object = body.as_object_mut().expect("a shared object");
        object.insert("type".to_owned(), json!("evaluation"));
        object.insert("managers".to_owned(), json!({"own.cpp": Self::hex(0xb1)}));
        object.insert("info".to_owned(), json!("evaluate user test 7"));
        object.insert("executables".to_owned(), json!({"ut": Self::hex(0xd1)}));
        object.insert("input".to_owned(), json!(Self::hex(0xe1)));
        object.insert("output".to_owned(), Value::Null);
        object.insert("time_limit".to_owned(), json!(2.5));
        object.insert("memory_limit".to_owned(), json!(268_435_456i64));
        object.insert("only_execution".to_owned(), json!(true));
        object.insert("get_output".to_owned(), json!(true));
        object.insert("outcome".to_owned(), Value::Null);
        object.insert("user_output".to_owned(), Value::Null);
        Self::add_worker_defaults(object);
        body
    }

    /// The seven keys the worker fills after the body reaches it.
    fn add_worker_defaults(object: &mut serde_json::Map<String, Value>) {
        for (key, value) in [
            ("shard", Value::Null),
            ("keep_sandbox", json!(false)),
            ("sandboxes", json!([])),
            ("sandbox_digests", json!({})),
            ("success", Value::Null),
            ("text", Value::Null),
            ("admin_text", Value::Null),
            ("plus", Value::Null),
        ] {
            object.insert(key.to_owned(), value);
        }
    }
}
