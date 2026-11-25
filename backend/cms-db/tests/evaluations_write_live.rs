//! The evaluations row-set write against the frozen schema and a real server.
//!
//! RUN: CMS_DB_TEST_URL=postgres://postgres:***@127.0.0.1:15433/cmsdb_test \
//!        cargo test -p cms-db --test evaluations_write_live
//!
//! WHY a scratch database: the shared test database is not reset between runs.
//! WHY replica role: the frozen FKs would force seeding parent tables the write
//! never touches; the schema itself stays exactly as the fixture dumps it.

use cms_db::{DatasetId, EvaluationRow, ObjectWrite, SubmissionId};
use sqlx::postgres::PgConnection;
use sqlx::{AssertSqlSafe, Connection};

#[allow(dead_code)]
#[path = "support/schema_check.rs"]
mod schema_check;

/// The scratch database the frozen schema is created in and dropped after.
const CHECK_DATABASE: &str = "cms_eval_write_check";
const SUBMISSION: i32 = 100;
const DATASET: i32 = 20;
const TESTCASE_A: i32 = 40;
const TESTCASE_B: i32 = 41;

/// One object's rows: differing text lengths, and NULL, empty and filled lists.
fn rows() -> Vec<EvaluationRow> {
    vec![
        EvaluationRow {
            submission_id: SubmissionId(SUBMISSION),
            dataset_id: DatasetId(DATASET),
            testcase_id: TESTCASE_A,
            outcome: Some("1.0".to_string()),
            text: vec!["en: right".to_string(), "th: ถูกต้อง".to_string()],
            admin_text: None,
            execution_time: Some(0.1),
            execution_wall_clock_time: Some(0.2),
            execution_memory: Some(1024),
            evaluation_shard: Some(0),
            evaluation_sandbox_paths: Some(vec!["/tmp/a".to_string(), "/tmp/b".to_string()]),
            evaluation_sandbox_digests: None,
        },
        EvaluationRow {
            submission_id: SubmissionId(SUBMISSION),
            dataset_id: DatasetId(DATASET),
            testcase_id: TESTCASE_B,
            outcome: Some("0.5".to_string()),
            text: vec!["only one".to_string()],
            admin_text: Some("admin".to_string()),
            execution_time: Some(0.2),
            execution_wall_clock_time: Some(0.4),
            execution_memory: Some(2048),
            evaluation_shard: Some(1),
            evaluation_sandbox_paths: Some(Vec::new()),
            evaluation_sandbox_digests: Some(vec!["deadbeef".to_string()]),
        },
    ]
}

/// The non-key columns read back after the write.
#[derive(Debug, sqlx::FromRow)]
struct StoredEvaluation {
    testcase_id: i32,
    outcome: Option<String>,
    text: Vec<String>,
    admin_text: Option<String>,
    execution_time: Option<f64>,
    execution_wall_clock_time: Option<f64>,
    execution_memory: Option<i64>,
    evaluation_shard: Option<i32>,
    evaluation_sandbox_paths: Option<Vec<String>>,
    evaluation_sandbox_digests: Option<Vec<String>>,
}

#[tokio::test]
async fn one_object_rows_round_trip_their_per_row_arrays() {
    let Some(url) = schema_check::skip() else {
        return;
    };
    let check_url = schema_check::with_database(&url, CHECK_DATABASE);
    let mut base = PgConnection::connect(&url)
        .await
        .expect("connecting to the scratch database");
    schema_check::create_database(&mut base, CHECK_DATABASE).await;

    let mut connection = PgConnection::connect(&check_url)
        .await
        .expect("connecting to the check database");
    // WHY statement by statement: dev/fixtures/cms_schema.sql is the frozen schema.
    for statement in schema_check::statements(schema_check::FIXTURE) {
        sqlx::raw_sql(AssertSqlSafe(statement))
            .execute(&mut connection)
            .await
            .expect("creating the frozen schema");
    }
    sqlx::raw_sql(AssertSqlSafe("SET session_replication_role = replica"))
        .execute(&mut connection)
        .await
        .expect("disabling FK triggers for the write");

    let written = rows();
    ObjectWrite::write_evaluations(&mut connection, &written)
        .await
        .expect("writing one object's evaluations");

    let stored: Vec<StoredEvaluation> = sqlx::query_as::<_, StoredEvaluation>(
        "SELECT testcase_id, outcome, text, admin_text, execution_time, \
                execution_wall_clock_time, execution_memory, evaluation_shard, \
                evaluation_sandbox_paths, evaluation_sandbox_digests \
         FROM evaluations WHERE submission_id = $1 AND dataset_id = $2 \
         ORDER BY testcase_id",
    )
    .bind(SUBMISSION)
    .bind(DATASET)
    .fetch_all(&mut connection)
    .await
    .expect("reading the stored evaluations");

    assert_eq!(stored.len(), 2, "one statement wrote both testcases");
    // Element order, differing lengths, and NULL vs empty, per row.
    assert_eq!(stored[0].testcase_id, TESTCASE_A);
    assert_eq!(stored[0].text, vec!["en: right", "th: ถูกต้อง"]);
    assert_eq!(
        stored[0].evaluation_sandbox_paths,
        Some(vec!["/tmp/a".to_string(), "/tmp/b".to_string()])
    );
    assert_eq!(stored[0].evaluation_sandbox_digests, None);
    assert_eq!(stored[0].outcome.as_deref(), Some("1.0"));
    assert_eq!(stored[0].execution_memory, Some(1024));
    assert_eq!(stored[0].execution_time, Some(0.1));
    assert_eq!(stored[0].execution_wall_clock_time, Some(0.2));
    assert_eq!(stored[0].evaluation_shard, Some(0));
    assert_eq!(stored[0].admin_text, None);
    assert_eq!(stored[1].testcase_id, TESTCASE_B);
    assert_eq!(stored[1].text, vec!["only one"]);
    assert_eq!(
        stored[1].evaluation_sandbox_paths,
        Some(Vec::<String>::new())
    );
    assert_eq!(
        stored[1].evaluation_sandbox_digests,
        Some(vec!["deadbeef".to_string()])
    );
    assert_eq!(stored[1].outcome.as_deref(), Some("0.5"));
    assert_eq!(stored[1].execution_memory, Some(2048));
    assert_eq!(stored[1].execution_time, Some(0.2));
    assert_eq!(stored[1].execution_wall_clock_time, Some(0.4));
    assert_eq!(stored[1].evaluation_shard, Some(1));
    assert_eq!(stored[1].admin_text.as_deref(), Some("admin"));

    drop(connection);
    schema_check::drop_database(&mut base, CHECK_DATABASE).await;
}
