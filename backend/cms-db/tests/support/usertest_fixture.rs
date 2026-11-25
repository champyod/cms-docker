//! The user-test rows the unit suites build, one fixture per table.

use chrono::NaiveDate;
use cms_db::{
    DatasetId, DatasetRecord, FileDigest, Filename, FilenameSchema, UserTest, UserTestExecutable,
    UserTestFile, UserTestManager,
};

/// Forty lowercase hex characters, which every `DIGEST` column accepts.
pub const DIGEST: &str = "0123456789abcdef0123456789abcdef01234567";

/// The user test every fixture belongs to.
pub const USER_TEST: i32 = 7;

/// The task that user test was requested on.
pub const TASK: i32 = 42;

/// A valid fixture digest.
pub fn digest() -> FileDigest {
    DIGEST.parse().expect("fixture digest is valid")
}

/// A fixture filename schema.
pub fn schema(value: &str) -> FilenameSchema {
    FilenameSchema::parse(value).expect("fixture name is a schema")
}

/// A fixture filename.
pub fn filename(value: &str) -> Filename {
    Filename::parse(value).expect("fixture name is a filename")
}

/// A user test on [`TASK`].
pub fn user_test() -> UserTest {
    UserTest {
        id: USER_TEST,
        participation_id: 3,
        task_id: TASK,
        timestamp: NaiveDate::from_ymd_opt(2026, 11, 22)
            .and_then(|date| date.and_hms_opt(10, 0, 0))
            .expect("fixture time is valid"),
        language: Some("cpp".to_string()),
        input: digest(),
    }
}

/// One uploaded file of a user test.
pub fn file(user_test_id: i32, name: &str) -> UserTestFile {
    UserTestFile {
        id: 1,
        user_test_id,
        filename: schema(name),
        digest: digest(),
    }
}

/// One manager file of a user test.
pub fn manager(user_test_id: i32, name: &str) -> UserTestManager {
    UserTestManager {
        id: 1,
        user_test_id,
        filename: filename(name),
        digest: digest(),
    }
}

/// One executable of a result.
pub fn executable(user_test_id: i32, dataset_id: i32, name: &str) -> UserTestExecutable {
    UserTestExecutable {
        id: 1,
        user_test_id,
        dataset_id,
        filename: filename(name),
        digest: digest(),
    }
}

/// One dataset of a task.
pub fn dataset(id: i32, task_id: i32) -> DatasetRecord {
    DatasetRecord {
        id: DatasetId(id),
        task_id,
        task_type: "Batch".to_string(),
        task_type_parameters: "{}".to_string(),
        score_type: "Sum".to_string(),
        score_type_parameters: "0".to_string(),
        time_limit: Some(1.0),
        memory_limit: None,
        is_active: true,
    }
}
