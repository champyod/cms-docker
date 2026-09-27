//! The four judging reads, mapped against fixture rows rather than a database.
//!
//! Every fixture below is a value the named column actually holds: forty
//! characters of lowercase hex for a `DIGEST`, a time without a zone for a
//! `timestamp`, absent values for the nullable columns. No connection is opened.

use chrono::{DateTime, NaiveDateTime};
use cms_db::{
    dataset_from_row, result_from_row, submission_from_row, testcase_from_row, DatasetRecord,
    DigestError, ReadError, ResultKey, ResultRecord, SubmissionRecord, TestcaseRecord,
    DATASET_BY_ID, RESULT_BY_SUBMISSION_AND_DATASET, SUBMISSION_BY_ID, TESTCASES_BY_DATASET,
};

/// Forty lowercase hex characters, which is what `testcases.input` holds.
const INPUT_DIGEST: &str = "0123456789abcdef0123456789abcdef01234567";

/// Forty lowercase hex characters, which is what `testcases.output` holds.
const OUTPUT_DIGEST: &str = "fedcba9876543210fedcba9876543210fedcba98";

/// Sixteen characters, which the `DIGEST` domain refuses.
const REFUSED_DIGEST: &str = "0123456789abcdef";

/// A `testcases.codename`: letters, a digit and a dash, which the domain allows.
const CODENAME: &str = "greeting-01";

/// The `datasets.task_type` of the fixture, which names a `TaskType`.
const BATCH: &str = "Batch";

/// Seconds a `submissions.timestamp` column holds, read as a time without a zone.
const SUBMITTED_EPOCH_SECONDS: i64 = 1_700_000_000;

/// Ids that stand for nothing: every one of them is a fixture.
const SUBMISSION_ID: i32 = 41;
const TASK_ID: i32 = 7;
const PARTICIPATION_ID: i32 = 12;
const DATASET_ID: i32 = 9;

/// The composite key one `submission_results` row is read by.
const RESULT_KEY: ResultKey = ResultKey {
    submission_id: SUBMISSION_ID,
    dataset_id: DATASET_ID,
};

/// Every query the module holds, under the name it is checked by.
const QUERIES: [(&str, &str); 4] = [
    ("SUBMISSION_BY_ID", SUBMISSION_BY_ID),
    (
        "RESULT_BY_SUBMISSION_AND_DATASET",
        RESULT_BY_SUBMISSION_AND_DATASET,
    ),
    ("DATASET_BY_ID", DATASET_BY_ID),
    ("TESTCASES_BY_DATASET", TESTCASES_BY_DATASET),
];

/// The time a `submissions.timestamp` column holds, without a zone.
const fn submitted_at() -> NaiveDateTime {
    DateTime::from_timestamp(SUBMITTED_EPOCH_SECONDS, 0)
        .expect("fixture seconds are in range")
        .naive_utc()
}

/// One submission of [`TASK_ID`], carrying the language and the flag it was given.
fn submission_row(language: Option<&str>, official: bool) -> SubmissionRecord {
    submission_from_row(
        SUBMISSION_ID,
        TASK_ID,
        PARTICIPATION_ID,
        submitted_at(),
        language.map(str::to_string),
        official,
    )
}

/// One testcase of [`DATASET_ID`], carrying the two digests it was given.
fn testcase_row(input: &str, output: &str) -> Result<TestcaseRecord, ReadError> {
    testcase_from_row(3, DATASET_ID, CODENAME.to_string(), true, input, output)
}

/// The placeholders a query carries, in the order it writes them.
fn bound_placeholders(sql: &str) -> Vec<String> {
    sql.split_ascii_whitespace()
        .filter(|token| {
            token
                .strip_prefix('$')
                .is_some_and(|at| at.bytes().all(|b| b.is_ascii_digit()))
        })
        .map(str::to_string)
        .collect()
}

#[test]
fn a_submission_row_maps_onto_its_record() {
    let record = submission_row(Some("rust"), true);

    assert_eq!(
        record,
        SubmissionRecord {
            id: SUBMISSION_ID,
            task_id: TASK_ID,
            participation_id: PARTICIPATION_ID,
            timestamp: submitted_at(),
            language: Some("rust".to_string()),
            official: true,
        }
    );
}

#[test]
fn a_submission_with_no_language_and_no_score_place_carries_both() {
    let record = submission_row(None, false);

    assert!(record.language.is_none() && !record.official);
}

#[test]
fn a_result_row_maps_its_key_its_flags_and_its_tries_onto_its_record() {
    let record = result_from_row(RESULT_KEY, true, true, 1, false, 0);

    assert_eq!(
        record,
        ResultRecord {
            submission_id: SUBMISSION_ID,
            dataset_id: DATASET_ID,
            is_compiled: true,
            is_compilation_succeeded: true,
            compilation_tries: 1,
            is_evaluated: false,
            evaluation_tries: 0,
        }
    );
}

#[test]
fn a_result_that_has_never_compiled_carries_no_tries() {
    let record = result_from_row(RESULT_KEY, false, false, 0, false, 0);

    assert!(!record.is_compiled && !record.is_compilation_succeeded);
    assert!(!record.is_evaluated);
    assert_eq!(record.compilation_tries, 0);
    assert_eq!(record.evaluation_tries, 0);
}

#[test]
fn a_dataset_row_maps_with_and_without_its_limits() {
    let limited = dataset_from_row(
        DATASET_ID,
        TASK_ID,
        BATCH.to_string(),
        Some(5.0),
        Some(268_435_456),
        true,
    );
    let bare = dataset_from_row(DATASET_ID, TASK_ID, BATCH.to_string(), None, None, false);

    assert_eq!(
        limited,
        DatasetRecord {
            id: DATASET_ID,
            task_id: TASK_ID,
            task_type: BATCH.to_string(),
            time_limit: Some(5.0),
            memory_limit: Some(268_435_456),
            is_active: true,
        }
    );
    assert!(bare.time_limit.is_none() && bare.memory_limit.is_none());
    assert!(!bare.is_active);
}

#[test]
fn a_testcase_row_maps_onto_its_record_with_both_digests_typed() {
    let record = testcase_row(INPUT_DIGEST, OUTPUT_DIGEST)
        .expect("both fixtures are digests the domain allows");

    assert_eq!(
        record,
        TestcaseRecord {
            id: 3,
            dataset_id: DATASET_ID,
            codename: CODENAME.to_string(),
            is_public: true,
            input: INPUT_DIGEST.parse().expect("fixture digest"),
            output: OUTPUT_DIGEST.parse().expect("fixture digest"),
        }
    );
}

#[test]
fn a_testcase_row_names_the_column_whose_digest_the_domain_refuses() {
    let refused = DigestError::Length {
        found: REFUSED_DIGEST.len(),
    };

    assert_eq!(
        testcase_row(REFUSED_DIGEST, OUTPUT_DIGEST),
        Err(ReadError::Digest("testcases.input", refused.clone()))
    );
    assert_eq!(
        testcase_row(INPUT_DIGEST, REFUSED_DIGEST),
        Err(ReadError::Digest("testcases.output", refused))
    );
}

#[test]
fn every_query_asks_only_for_what_it_names_and_binds_in_order() {
    for (name, sql) in QUERIES {
        let bound = bound_placeholders(sql);
        let ordered: Vec<String> = (1..=bound.len()).map(|at| format!("${at}")).collect();

        assert!(!sql.contains('*'), "{name} asks for a column");
        assert!(sql.starts_with("SELECT "), "{name} is not a select");
        assert_eq!(bound, ordered, "{name} binds out of order");
    }
}

#[test]
fn the_result_query_binds_its_key_in_order_and_projects_every_flag() {
    let query = RESULT_BY_SUBMISSION_AND_DATASET;
    let key_order = "WHERE r.submission_id = $1 AND r.dataset_id = $2";

    assert!(query.contains(key_order), "the key binds out of order");
    for projection in [
        "r.compilation_outcome IS NOT NULL AS is_compiled",
        "r.compilation_outcome = 'ok' AS is_compilation_succeeded",
        "r.evaluation_outcome IS NOT NULL AS is_evaluated",
    ] {
        assert!(query.contains(projection), "a declared flag is missing");
    }
}

#[test]
fn the_dataset_query_leaves_a_task_with_no_active_dataset_inactive() {
    let flag = "t.active_dataset_id IS NOT DISTINCT FROM d.id AS is_active";

    assert!(DATASET_BY_ID.contains(flag), "a NULL active dataset leaks");
}
