use chrono::{DateTime, NaiveDateTime};

use cms_db::{
    dataset_from_row, submission_from_row, testcase_from_row, DatasetId, DatasetRecord, Evaluation,
    FileDigest, SubmissionId, SubmissionRecord, SubmissionResult, TestcaseRecord, UserTest,
    UserTestResult,
};

const TIMESTAMP_SECONDS: i64 = 1_700_000_000;
const USER_TEST_TIMESTAMP_SECONDS: i64 = TIMESTAMP_SECONDS + 60;
const INPUT_DIGEST: &str = "0123456789abcdef0123456789abcdef01234567";
const OUTPUT_DIGEST: &str = "fedcba9876543210fedcba9876543210fedcba98";

pub(super) fn submission_result() -> SubmissionResult {
    SubmissionResult::new(SubmissionId(11), DatasetId(22))
}

pub(super) fn user_test_result() -> UserTestResult {
    UserTestResult::new(33, 22)
}

pub(super) fn evaluation(testcase_id: i32) -> Evaluation {
    Evaluation {
        id: testcase_id,
        submission_id: 11,
        dataset_id: 22,
        testcase_id,
        outcome: None,
        text: Vec::new(),
        admin_text: None,
        execution_time: None,
        execution_wall_clock_time: None,
        execution_memory: None,
        evaluation_shard: None,
        evaluation_sandbox_paths: None,
        evaluation_sandbox_digests: None,
    }
}

pub(super) fn timestamp() -> NaiveDateTime {
    DateTime::from_timestamp(TIMESTAMP_SECONDS, 0)
        .expect("fixture seconds are in range")
        .naive_utc()
}

pub(super) fn submission() -> SubmissionRecord {
    submission_from_row(
        SubmissionId(11),
        7,
        12,
        timestamp(),
        Some("cpp20".to_string()),
        true,
    )
}

pub(super) fn user_test() -> UserTest {
    UserTest {
        id: 33,
        participation_id: 12,
        task_id: 7,
        timestamp: user_test_timestamp(),
        language: Some("cpp20".to_string()),
        input: FileDigest::tombstone(),
    }
}

pub(super) fn user_test_timestamp() -> NaiveDateTime {
    DateTime::from_timestamp(USER_TEST_TIMESTAMP_SECONDS, 0)
        .expect("fixture seconds are in range")
        .naive_utc()
}

pub(super) fn dataset(is_active: bool) -> DatasetRecord {
    dataset_from_row(
        DatasetId(22),
        7,
        "Batch".to_string(),
        "Sum".to_string(),
        "{}".to_string(),
        (None, None),
        is_active,
    )
}

pub(super) fn testcases() -> Vec<TestcaseRecord> {
    [(30, "gamma"), (10, "alpha"), (20, "beta")]
        .into_iter()
        .map(|(id, codename)| {
            testcase_from_row(
                id,
                22,
                codename.to_string(),
                false,
                INPUT_DIGEST,
                OUTPUT_DIGEST,
            )
            .expect("fixture digests are valid")
        })
        .collect()
}
