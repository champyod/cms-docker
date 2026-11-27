//! Live fixtures for the user-test commit: a frozen schema and the two parent
//! rows its foreign keys need, with replica role suppressing grandparent FKs.

use cms_db::{
    AuditRow, RowState, UserTestExecutableRow, UserTestOperation, UserTestResult,
    UserTestResultRow, UserTestWrite,
};
use sqlx::postgres::PgConnection;
use sqlx::{AssertSqlSafe, Connection, FromRow};

// Each test target includes this module and uses a different subset of it, so a
// helper unused by one target is not dead code.
#[allow(dead_code)]
#[path = "schema_check.rs"]
pub mod schema_check;

/// The scratch database this target owns, named per fixture below.
pub const CHECK_PREFIX: &str = "cms_user_test_commit_check";
/// The user test and dataset the result row is keyed by.
pub const USER_TEST: i32 = 300;
pub const DATASET: i32 = 200;

/// A digest the frozen `digest` domain accepts.
pub const OLD_DIGEST: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
/// A second digest, for the executable the recompilation replaces.
pub const NEW_DIGEST: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const SEED: &[&str] = &[
    "INSERT INTO datasets (id, task_id, description, autojudge, task_type, \
        task_type_parameters, score_type, score_type_parameters) \
     VALUES (200, 1, 'd', true, 'Batch', '{}', 'Sum', '{}')",
    "INSERT INTO user_tests (id, participation_id, task_id, timestamp, input) \
     VALUES (300, 1, 1, '2020-01-01 00:00:00', \
        '0123456789abcdef0123456789abcdef01234567')",
];

/// Opens the scratch database with the frozen schema and the parent rows.
///
/// The database name is returned with the connections because each fixture owns
/// its own: tests in this target run in parallel.
pub async fn open() -> Option<(PgConnection, PgConnection, String)> {
    let url = schema_check::skip()?;
    let name = schema_check::unique_database(CHECK_PREFIX);
    let check_url = schema_check::with_database(&url, &name);
    let mut base = PgConnection::connect(&url)
        .await
        .expect("connecting to the scratch database");
    schema_check::create_database(&mut base, &name).await;

    let mut connection = PgConnection::connect(&check_url)
        .await
        .expect("connecting to the check database");
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
    Some((base, connection, name))
}

/// Opens the fixture, failing by name when no scratch database was configured.
pub async fn require_open() -> (PgConnection, PgConnection, String) {
    open().await.expect("CMS_DB_TEST_URL must be configured")
}

/// Drops the scratch database so a failing assertion is the only residue.
pub async fn close(mut base: PgConnection, name: &str) {
    schema_check::drop_database(&mut base, name).await;
}

/// One result row with every column the statement binds set to a known value.
pub fn result_row() -> UserTestResultRow {
    let mut row = UserTestResultRow::new(USER_TEST, DATASET);
    row.compilation_outcome = Some("ok".to_owned());
    row.compilation_text = vec!["en: compiled".to_owned(), "th: คอมไพล์".to_owned()];
    row.compilation_tries = 1;
    row.compilation_stdout = Some("out".to_owned());
    row.compilation_stderr = Some("err".to_owned());
    row.compilation_time = Some(0.25);
    row.compilation_wall_clock_time = Some(0.5);
    row.compilation_memory = Some(4096);
    row.compilation_shard = Some(2);
    row.compilation_sandbox_paths = Some(vec!["/tmp/a".to_owned(), "/tmp/b".to_owned()]);
    row.compilation_sandbox_digests = Some(vec![OLD_DIGEST.to_owned()]);
    row
}

/// One executable of the compilation fixture.
pub fn executable(filename: &str, digest: &str) -> UserTestExecutableRow {
    UserTestExecutableRow::new(
        USER_TEST,
        DATASET,
        filename,
        digest.parse().expect("a valid fixture digest"),
    )
    .expect("a valid fixture filename")
}

/// One audit row, so the batch is permitted to reach the database.
pub fn audit(result: &UserTestResultRow) -> AuditRow {
    AuditRow {
        actor_id: None,
        verb: "usertestresult:create".to_owned(),
        entity: "user_test_results".to_owned(),
        entity_id: format!("{USER_TEST}/{DATASET}"),
        before: None,
        after: RowState::UserTestResult(result.clone()),
        reason: "judging commit".to_owned(),
    }
}

/// One compilation write carrying two executables.
pub fn compilation(digests: [&str; 2]) -> UserTestWrite {
    let result = result_row();
    UserTestWrite {
        operation: UserTestOperation::Compilation,
        result,
        executables: vec![
            executable("a.out", digests[0]),
            executable("stub", digests[1]),
        ],
        audit: Vec::new(),
    }
}

/// A write with its required audit declaration attached.
pub fn recorded(mut write: UserTestWrite) -> UserTestWrite {
    let declaration = audit(&write.result);
    write.audit.push(declaration);
    write
}

/// The result row exactly as the database stores it, with domains as text.
#[derive(Debug, FromRow)]
pub struct Stored {
    pub user_test_id: i32,
    pub dataset_id: i32,
    pub output: Option<String>,
    pub compilation_outcome: Option<String>,
    pub compilation_text: Vec<String>,
    pub compilation_tries: i32,
    pub compilation_stdout: Option<String>,
    pub compilation_stderr: Option<String>,
    pub compilation_time: Option<f64>,
    pub compilation_wall_clock_time: Option<f64>,
    pub compilation_memory: Option<i64>,
    pub compilation_shard: Option<i32>,
    pub compilation_sandbox_paths: Option<Vec<String>>,
    pub compilation_sandbox_digests: Option<Vec<String>>,
    pub evaluation_outcome: Option<String>,
    pub evaluation_text: Vec<String>,
    pub evaluation_tries: i32,
    pub execution_time: Option<f64>,
    pub execution_wall_clock_time: Option<f64>,
    pub execution_memory: Option<i64>,
    pub evaluation_shard: Option<i32>,
    pub evaluation_sandbox_paths: Option<Vec<String>>,
    pub evaluation_sandbox_digests: Option<Vec<String>>,
}

const READ_RESULT: &str = "\
    SELECT user_test_id, dataset_id, output::text AS output, \
        compilation_outcome, compilation_text, compilation_tries, \
        compilation_stdout, compilation_stderr, compilation_time, \
        compilation_wall_clock_time, compilation_memory, compilation_shard, \
        compilation_sandbox_paths, compilation_sandbox_digests, \
        evaluation_outcome, evaluation_text, evaluation_tries, execution_time, \
        execution_wall_clock_time, execution_memory, evaluation_shard, \
        evaluation_sandbox_paths, evaluation_sandbox_digests \
    FROM user_test_results WHERE user_test_id = $1 AND dataset_id = $2";

pub async fn stored(connection: &mut PgConnection) -> Stored {
    sqlx::query_as::<_, Stored>(READ_RESULT)
        .bind(USER_TEST)
        .bind(DATASET)
        .fetch_one(connection)
        .await
        .expect("the committed result is readable")
}

#[derive(Debug, FromRow)]
pub struct StoredExecutable {
    pub filename: String,
    pub digest: String,
}

pub async fn executables(connection: &mut PgConnection) -> Vec<StoredExecutable> {
    sqlx::query_as::<_, StoredExecutable>(
        "SELECT filename, digest::text AS digest FROM user_test_executables \
         WHERE user_test_id = $1 AND dataset_id = $2 ORDER BY filename",
    )
    .bind(USER_TEST)
    .bind(DATASET)
    .fetch_all(connection)
    .await
    .expect("reading stored executables")
}

/// Asserts every compilation column of a stored result against its write shape.
pub fn assert_compilation_columns(row: &Stored, expected: &UserTestResultRow) {
    assert_eq!(row.user_test_id, USER_TEST);
    assert_eq!(row.dataset_id, DATASET);
    assert_eq!(row.output, None, "no evaluation ran");
    assert_eq!(row.compilation_outcome, expected.compilation_outcome);
    assert_eq!(row.compilation_text, expected.compilation_text);
    assert_eq!(row.compilation_tries, expected.compilation_tries);
    assert_eq!(row.compilation_stdout, expected.compilation_stdout);
    assert_eq!(row.compilation_stderr, expected.compilation_stderr);
    assert_eq!(row.compilation_time, expected.compilation_time);
    assert_eq!(
        row.compilation_wall_clock_time,
        expected.compilation_wall_clock_time
    );
    assert_eq!(row.compilation_memory, expected.compilation_memory);
    assert_eq!(row.compilation_shard, expected.compilation_shard);
    assert_eq!(
        row.compilation_sandbox_paths,
        expected.compilation_sandbox_paths
    );
    assert_eq!(
        row.compilation_sandbox_digests,
        expected.compilation_sandbox_digests
    );
}

/// Asserts that no evaluation half was written by a compilation.
pub fn assert_no_evaluation(row: &Stored) {
    assert_eq!(
        row.evaluation_outcome, None,
        "no evaluation outcome was written"
    );
    assert!(row.evaluation_text.is_empty(), "no grader text was written");
    assert_eq!(row.evaluation_tries, 0, "no evaluation attempt was written");
    assert_eq!(row.execution_time, None);
    assert_eq!(row.execution_wall_clock_time, None);
    assert_eq!(row.execution_memory, None);
    assert_eq!(row.evaluation_shard, None);
    assert_eq!(row.evaluation_sandbox_paths, None);
    assert_eq!(row.evaluation_sandbox_digests, None);
}

/// The evaluation half of a stored result, preserving its compilation columns.
pub fn evaluated_row(prior: &UserTestResult) -> UserTestResultRow {
    let mut result = UserTestResultRow::new(USER_TEST, DATASET);
    result.compilation_outcome = prior
        .compilation_outcome
        .map(|outcome| outcome.as_str().to_owned());
    result.compilation_text.clone_from(&prior.compilation_text);
    result.compilation_tries = prior.compilation_tries;
    result
        .compilation_sandbox_paths
        .clone_from(&prior.compilation_sandbox_paths);
    result
        .compilation_sandbox_digests
        .clone_from(&prior.compilation_sandbox_digests);
    result.output = Some(NEW_DIGEST.parse().expect("a valid digest"));
    result.evaluation_outcome = Some("ok".to_owned());
    result.evaluation_text = vec!["Correct".to_owned()];
    result.execution_time = Some(1.5);
    result.evaluation_shard = Some(3);
    result
}
