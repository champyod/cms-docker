//! The four judging reads, mapped against fixture rows rather than a database.
//!
//! Every fixture is a value the named column actually holds: forty lowercase hex for
//! a `DIGEST`, a time without a zone, absent nullable values. No connection is opened.

use chrono::{DateTime, NaiveDateTime};
use cms_db::{
    dataset_from_row, result_from_row, submission_from_row, testcase_from_row, DatasetRecord,
    DigestError, ReadError, ResultRecord, SubmissionRecord, TestcaseRecord, DATASET_BY_ID,
    RESULT_BY_SUBMISSION_AND_DATASET, SUBMISSION_BY_ID, TESTCASES_BY_DATASET,
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

/// Every query the module holds, and the record fields it projects, in row order.
const QUERIES: [(&str, &str); 4] = [
    (SUBMISSION_BY_ID, "id task_id participation_id timestamp language official"),
    (RESULT_BY_SUBMISSION_AND_DATASET, "submission_id dataset_id is_compiled is_compilation_succeeded compilation_tries is_evaluated evaluation_tries"),
    (DATASET_BY_ID, "id task_id task_type time_limit memory_limit is_active"),
    (TESTCASES_BY_DATASET, "id dataset_id codename is_public input output"),
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

/// The name every projection answers under, in row order: its alias, or the column
/// behind it, since only a select list holds a comma before the FROM and WHERE clauses.
fn projected_names(sql: &str) -> Vec<&str> {
    let mut segments: Vec<&str> = sql.split(',').map(str::trim).collect();
    let last = segments.pop().expect("a query selects");
    segments.push(last.lines().next().unwrap_or_default());
    let mut names = Vec::new();
    for part in segments {
        let mut words = part.split_ascii_whitespace();
        let token = words.next_back().unwrap_or(part);
        names.push(token.rsplit_once('.').map_or(token, |(_, column)| column));
    }
    names
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
fn a_result_row_maps_its_ids_its_flags_and_its_tries_onto_its_record() {
    let record = result_from_row(SUBMISSION_ID, DATASET_ID, true, true, 1, false, 0);

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
    let record = result_from_row(SUBMISSION_ID, DATASET_ID, false, false, 0, false, 0);

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
fn every_query_asks_only_for_what_it_names_binds_in_order_and_maps() {
    for (sql, fields) in QUERIES {
        let bound = bound_placeholders(sql);
        let ordered: Vec<String> = (1..=bound.len()).map(|at| format!("${at}")).collect();
        let projected = projected_names(sql);
        let declared: Vec<&str> = fields.split_ascii_whitespace().collect();

        assert!(!sql.contains('*'), "{sql} asks for a column");
        assert!(sql.starts_with("SELECT "), "{sql} is not a select");
        assert_eq!(bound, ordered, "{sql} binds out of order");
        assert_eq!(projected, declared, "{sql} does not project its record");
    }
}

#[test]
fn the_result_query_binds_its_key_in_order_and_projects_every_flag() {
    let query = RESULT_BY_SUBMISSION_AND_DATASET;
    let key_order = "WHERE r.submission_id = $1 AND r.dataset_id = $2";

    assert!(query.contains(key_order), "the key binds out of order");
    for projection in [
        "r.compilation_outcome IS NOT NULL AS is_compiled",
        "r.compilation_outcome = 'ok' IS TRUE AS is_compilation_succeeded",
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
