//! Live fixtures and readers shared by the commit's integration tests.

use cms_db::{DatasetId, ExecutableRow, ObjectWrite, OperationType, ResultRow, SubmissionId};
use sqlx::postgres::PgConnection;
use sqlx::{AssertSqlSafe, Connection, FromRow};

#[allow(dead_code)]
#[path = "schema_check.rs"]
pub mod schema_check;

/// The scratch database the frozen schema is created in and dropped after.
pub const CHECK_DATABASE: &str = "cms_commit_check";
pub const SUBMISSION: i32 = 100;
pub const DATASET: i32 = 20;

pub const NEW_DIGEST: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

/// One dataset with two testcases and one submission; replica role disables the
/// grandparent FKs, but NOT NULL, CHECK and domain constraints still apply.
const SEED: &[&str] = &[
    "INSERT INTO datasets (id, task_id, description, autojudge, task_type, \
        task_type_parameters, score_type, score_type_parameters) \
     VALUES (20, 1, 'd', true, 'Batch', '{}', 'Sum', '{}')",
    "INSERT INTO testcases (id, dataset_id, codename, public, input, output) \
     VALUES (40, 20, 'tc_a', true, 'x', 'x'), (41, 20, 'tc_b', true, 'x', 'x')",
    "INSERT INTO submissions (id, opaque_id, participation_id, task_id, timestamp, comment, official) \
     VALUES (100, 1, 1, 1, '2020-01-01 00:00:00', 'c', true)",
];

/// A connection with the frozen schema, replica role and the parent rows, plus
/// the base connection used to drop it again.
pub async fn open() -> Option<(PgConnection, PgConnection)> {
    let url = schema_check::skip()?;
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
    for &statement in SEED {
        sqlx::raw_sql(AssertSqlSafe(statement))
            .execute(&mut connection)
            .await
            .expect("seeding the parent rows");
    }
    Some((base, connection))
}

/// Open the live fixture, failing by name when CMS_DB_TEST_URL is absent rather
/// than skipping.
pub async fn require_open() -> (PgConnection, PgConnection) {
    open()
        .await
        .expect("CMS_DB_TEST_URL must name a scratch database")
}

/// The result row an in-progress evaluation carries: evaluation_outcome NULL.
pub fn result_row() -> ResultRow {
    ResultRow {
        submission_id: SubmissionId(SUBMISSION),
        dataset_id: DatasetId(DATASET),
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
        evaluation_tries: 3,
    }
}

/// One compiled file a compilation carries.
pub fn executable_row(filename: &str, digest: &str) -> ExecutableRow {
    ExecutableRow {
        submission_id: SubmissionId(SUBMISSION),
        dataset_id: DatasetId(DATASET),
        filename: filename.to_string(),
        digest: digest.parse().expect("a valid digest"),
    }
}

/// A Compilation batch carrying exactly the given executable set.
pub fn compilation_batch(executables: Vec<ExecutableRow>) -> ObjectWrite {
    ObjectWrite {
        operation: OperationType::Compilation,
        submission_id: SubmissionId(SUBMISSION),
        dataset_id: DatasetId(DATASET),
        result: result_row(),
        executables,
        evaluations: Vec::new(),
        score: None,
        audit: Vec::new(),
    }
}

#[derive(Debug, FromRow)]
pub struct StoredResult {
    pub compilation_outcome: Option<String>,
    pub compilation_text: Vec<String>,
    pub compilation_tries: i32,
    pub evaluation_outcome: Option<String>,
    pub evaluation_tries: i32,
}

pub async fn stored_result(connection: &mut PgConnection) -> StoredResult {
    sqlx::query_as::<_, StoredResult>(
        "SELECT compilation_outcome::text AS compilation_outcome, compilation_text, \
                compilation_tries, evaluation_outcome::text AS evaluation_outcome, \
                evaluation_tries \
         FROM submission_results WHERE submission_id = $1 AND dataset_id = $2",
    )
    .bind(SUBMISSION)
    .bind(DATASET)
    .fetch_one(connection)
    .await
    .expect("reading the stored result")
}
