//! Every `submission_results` column the merged result writer sets, read back
//! through both result read paths against a real server: a row with every column
//! non-null and distinct, and a row whose optional columns are NULL.
//!
//! RUN: CMS_DB_TEST_URL=postgres://postgres:***@127.0.0.1:15433/cmsdb_test \
//!        cargo test -p cms-db --test reads_result_columns_live -- --test-threads=1

use cms_db::{
    get_submission_results, result_by_id, CompilationOutcome, DatasetId, EvaluationOutcome,
    ResultFilter, SubmissionId, SubmissionResult,
};
use sqlx::postgres::PgConnection;
use sqlx::{AssertSqlSafe, Connection, Row};

/// The pair whose row carries every column set to a distinct, non-null value.
const FULL_SUBMISSION: i32 = 7101;
const FULL_DATASET: i32 = 7102;
/// The pair whose row holds only the key, so every optional column is NULL.
const NULL_SUBMISSION: i32 = 7103;
const NULL_DATASET: i32 = 7104;

/// A live read fails by name when the URL is absent; it never silently skips.
fn url() -> String {
    std::env::var("CMS_DB_TEST_URL").expect(
        "CMS_DB_TEST_URL must name a scratch PostgreSQL database for the result-column read",
    )
}

/// Runs one fixture statement, refusing a failure instead of skipping it.
async fn exec(connection: &mut PgConnection, sql: &str) {
    sqlx::raw_sql(AssertSqlSafe(sql))
        .execute(&mut *connection)
        .await
        .expect("running fixture SQL");
}

/// A connection whose TEMP schema holds the two tables both read paths name and
/// the two submissions the search's join needs.
async fn setup() -> PgConnection {
    let mut connection = PgConnection::connect(&url())
        .await
        .expect("connecting to the scratch database");
    exec(
        &mut connection,
        "CREATE TEMP TABLE submissions (id integer PRIMARY KEY)",
    )
    .await;
    exec(
        &mut connection,
        "CREATE TEMP TABLE submission_results (
            submission_id integer NOT NULL,
            dataset_id integer NOT NULL,
            compilation_outcome varchar,
            compilation_text varchar[] NOT NULL DEFAULT '{}',
            compilation_tries integer NOT NULL DEFAULT 0,
            compilation_stdout varchar,
            compilation_stderr varchar,
            compilation_time double precision,
            compilation_wall_clock_time double precision,
            compilation_memory bigint,
            compilation_shard integer,
            compilation_sandbox_paths varchar[],
            compilation_sandbox_digests varchar[],
            evaluation_outcome varchar,
            evaluation_tries integer NOT NULL DEFAULT 0,
            score double precision,
            score_details jsonb,
            public_score double precision,
            public_score_details jsonb,
            ranking_score_details varchar[],
            PRIMARY KEY (submission_id, dataset_id))",
    )
    .await;
    exec(
        &mut connection,
        &format!("INSERT INTO submissions (id) VALUES ({FULL_SUBMISSION}), ({NULL_SUBMISSION})"),
    )
    .await;
    connection
}

/// What PostgreSQL itself renders for the two stored `jsonb` documents, read
/// without going through `SubmissionResult`: the independent oracle both paths
/// are checked against, so no normalisation is guessed.
async fn rendered_jsonb(connection: &mut PgConnection) -> (String, String) {
    let row = sqlx::query(
        "SELECT score_details::text AS score_details, \
                public_score_details::text AS public_score_details \
         FROM submission_results \
         WHERE submission_id = $1 AND dataset_id = $2",
    )
    .bind(FULL_SUBMISSION)
    .bind(FULL_DATASET)
    .fetch_one(connection)
    .await
    .expect("reading the rendered jsonb text");
    (row.get("score_details"), row.get("public_score_details"))
}

/// Seeds one row with every column non-null and distinct.
async fn seed_full(connection: &mut PgConnection) {
    exec(
        connection,
        &format!(
            "INSERT INTO submission_results (
                submission_id, dataset_id,
                compilation_outcome, compilation_text, compilation_tries,
                compilation_stdout, compilation_stderr, compilation_time,
                compilation_wall_clock_time, compilation_memory, compilation_shard,
                compilation_sandbox_paths, compilation_sandbox_digests,
                evaluation_outcome, evaluation_tries,
                score, score_details, public_score, public_score_details,
                ranking_score_details)
             VALUES (
                {FULL_SUBMISSION}, {FULL_DATASET},
                'ok', ARRAY['first line', 'second line', 'third line'], 3,
                'stdout-A', 'stderr-B', 1.25, 2.5,
                987654321, 7, ARRAY['/sandbox/a', '/sandbox/b'],
                ARRAY['digest-aaa', 'digest-bbb'],
                'ok', 5,
                6.5, '[10, 20]'::jsonb, 4.5, '[30, 40]'::jsonb,
                ARRAY['rank-one', 'rank-two'])"
        ),
    )
    .await;
}

#[tokio::test]
async fn every_result_column_round_trips_through_both_read_paths() {
    let mut connection = setup().await;
    seed_full(&mut connection).await;
    let (score_text, public_text) = rendered_jsonb(&mut connection).await;

    let expected = SubmissionResult {
        submission_id: SubmissionId(FULL_SUBMISSION),
        dataset_id: DatasetId(FULL_DATASET),
        compilation_outcome: Some(CompilationOutcome::Ok),
        compilation_text: vec![
            "first line".to_string(),
            "second line".to_string(),
            "third line".to_string(),
        ],
        compilation_tries: 3,
        compilation_stdout: Some("stdout-A".to_string()),
        compilation_stderr: Some("stderr-B".to_string()),
        compilation_time: Some(1.25),
        compilation_wall_clock_time: Some(2.5),
        compilation_memory: Some(987654321),
        compilation_shard: Some(7),
        compilation_sandbox_paths: Some(vec!["/sandbox/a".to_string(), "/sandbox/b".to_string()]),
        compilation_sandbox_digests: Some(vec!["digest-aaa".to_string(), "digest-bbb".to_string()]),
        evaluation_outcome: Some(EvaluationOutcome::Ok),
        evaluation_tries: 5,
        score: Some(6.5),
        score_details: Some(score_text),
        public_score: Some(4.5),
        public_score_details: Some(public_text),
        ranking_score_details: Some(vec!["rank-one".to_string(), "rank-two".to_string()]),
    };

    let by_id = result_by_id(
        &mut connection,
        SubmissionId(FULL_SUBMISSION),
        DatasetId(FULL_DATASET),
    )
    .await
    .expect("reading the full result by id")
    .expect("the full result exists");
    let search = get_submission_results(&mut connection, &ResultFilter::default())
        .await
        .expect("searching every result");

    // compilation_text keeps the array's order.
    assert_eq!(
        by_id.compilation_text,
        vec![
            "first line".to_string(),
            "second line".to_string(),
            "third line".to_string(),
        ],
        "compilation_text order"
    );
    // Both sandbox arrays come back intact and in order.
    assert_eq!(
        by_id.compilation_sandbox_paths,
        Some(vec!["/sandbox/a".to_string(), "/sandbox/b".to_string()]),
        "compilation_sandbox_paths"
    );
    assert_eq!(
        by_id.compilation_sandbox_digests,
        Some(vec!["digest-aaa".to_string(), "digest-bbb".to_string()]),
        "compilation_sandbox_digests"
    );

    // Every field, through both read paths.
    assert_eq!(search.len(), 1, "exactly one result from the search");
    assert_eq!(search[0], expected, "get_submission_results");
    assert_eq!(by_id, expected, "result_by_id");
}

#[tokio::test]
async fn null_optionals_read_as_none_and_empty_text_as_empty_vec() {
    let mut connection = setup().await;
    // Only the key is written: compilation_text takes its '{}' default, every
    // optional column stays NULL, and the two NOT NULL counters stay zero.
    exec(
        &mut connection,
        &format!(
            "INSERT INTO submission_results (submission_id, dataset_id) \
             VALUES ({NULL_SUBMISSION}, {NULL_DATASET})"
        ),
    )
    .await;

    let expected = SubmissionResult {
        submission_id: SubmissionId(NULL_SUBMISSION),
        dataset_id: DatasetId(NULL_DATASET),
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
        score: None,
        score_details: None,
        public_score: None,
        public_score_details: None,
        ranking_score_details: None,
    };

    let by_id = result_by_id(
        &mut connection,
        SubmissionId(NULL_SUBMISSION),
        DatasetId(NULL_DATASET),
    )
    .await
    .expect("reading the null result by id")
    .expect("the null result exists");
    let search = get_submission_results(&mut connection, &ResultFilter::default())
        .await
        .expect("searching every result");

    // An empty text column reads as an empty Vec, never as a missing one.
    assert_eq!(
        by_id.compilation_text,
        Vec::<String>::new(),
        "empty text is an empty Vec"
    );
    assert!(
        by_id.compilation_text.is_empty(),
        "empty text is an empty Vec, not None"
    );
    // Every NULL optional column reads as None.
    assert_eq!(by_id.compilation_stdout, None, "compilation_stdout");
    assert_eq!(by_id.compilation_stderr, None, "compilation_stderr");
    assert_eq!(by_id.compilation_time, None, "compilation_time");
    assert_eq!(
        by_id.compilation_wall_clock_time, None,
        "compilation_wall_clock_time"
    );
    assert_eq!(by_id.compilation_memory, None, "compilation_memory");
    assert_eq!(by_id.compilation_shard, None, "compilation_shard");
    assert_eq!(
        by_id.compilation_sandbox_paths, None,
        "compilation_sandbox_paths"
    );
    assert_eq!(
        by_id.compilation_sandbox_digests, None,
        "compilation_sandbox_digests"
    );

    // Every field, through both read paths.
    assert_eq!(search.len(), 1, "exactly one result from the search");
    assert_eq!(search[0], expected, "get_submission_results");
    assert_eq!(by_id, expected, "result_by_id");
}
