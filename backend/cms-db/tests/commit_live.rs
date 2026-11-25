//! The commit that turns one ObjectWrite into rows, against the frozen schema
//! and a real server.
//!
//! RUN: CMS_DB_TEST_URL=postgres://postgres:***@127.0.0.1:15433/cmsdb_test \
//!        cargo test -p cms-db --test commit_live
//!
//! WHY a scratch database: the shared test database is not reset between runs.
//! WHY replica role: the frozen FKs would force seeding grandparent tables the
//! commit never touches; the schema stays exactly as the fixture dumps it. No
//! audit_log table is created: init_db omits the Prisma-owned tables, the
//! chained writer that appends to it is a separate slice, and this layer hands
//! the batch's audit rows back instead of storing them.

use cms_db::{
    commit, AuditRow, DatasetId, EvaluationRow, ExecutableRow, ObjectWrite, OperationType,
    ResultRow, RowState, SubmissionId,
};
use sqlx::postgres::PgConnection;
use sqlx::{AssertSqlSafe, Connection, FromRow};

#[allow(dead_code)]
#[path = "support/schema_check.rs"]
mod schema_check;

/// The scratch database the frozen schema is created in and dropped after.
const CHECK_DATABASE: &str = "cms_commit_check";
const SUBMISSION: i32 = 100;
const DATASET: i32 = 20;
const TESTCASE_A: i32 = 40;
const TESTCASE_B: i32 = 41;

/// Digests the frozen `digest` domain accepts: forty lowercase hex characters.
const OLD_DIGEST: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const NEW_DIGEST: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

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
async fn open() -> Option<(PgConnection, PgConnection)> {
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

/// One testcase run, with per-row arrays that survive the write.
fn evaluation_row(testcase_id: i32) -> EvaluationRow {
    EvaluationRow {
        submission_id: SubmissionId(SUBMISSION),
        dataset_id: DatasetId(DATASET),
        testcase_id,
        outcome: Some("1.0".to_string()),
        text: vec!["en: right".to_string(), "th: ถูกต้อง".to_string()],
        admin_text: None,
        execution_time: Some(0.1),
        execution_wall_clock_time: Some(0.2),
        execution_memory: Some(1024),
        evaluation_shard: Some(0),
        evaluation_sandbox_paths: Some(vec!["/tmp/a".to_string(), "/tmp/b".to_string()]),
        evaluation_sandbox_digests: None,
    }
}

/// The result row an in-progress evaluation carries: evaluation_outcome NULL.
fn result_row() -> ResultRow {
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

/// One audit row, for the batch that must be refused.
fn audit_row(verb: &str) -> AuditRow {
    AuditRow {
        actor_id: Some(7),
        verb: verb.to_string(),
        entity: "evaluations".to_string(),
        entity_id: format!("{SUBMISSION}:{DATASET}"),
        before: None,
        after: RowState::Evaluation(evaluation_row(TESTCASE_A)),
        reason: "judged".to_string(),
    }
}

/// One Evaluation batch with no audit rows, carrying the given evaluation rows.
fn batch(evaluations: Vec<EvaluationRow>) -> ObjectWrite {
    ObjectWrite {
        operation: OperationType::Evaluation,
        submission_id: SubmissionId(SUBMISSION),
        dataset_id: DatasetId(DATASET),
        result: result_row(),
        executables: Vec::new(),
        evaluations,
        score: None,
        audit: Vec::new(),
    }
}

/// Open the live fixture, failing by name when CMS_DB_TEST_URL is absent rather
/// than skipping.
async fn require_open() -> (PgConnection, PgConnection) {
    open()
        .await
        .expect("CMS_DB_TEST_URL must name a scratch database")
}

/// Insert one executable directly, so the precondition does not depend on the
/// commit under test.
async fn seed_executable(connection: &mut PgConnection, filename: &str, digest: &str) {
    let insert = format!(
        "INSERT INTO executables (submission_id, dataset_id, filename, digest) \
         VALUES ({SUBMISSION}, {DATASET}, '{filename}', '{digest}')"
    );
    sqlx::raw_sql(AssertSqlSafe(insert))
        .execute(&mut *connection)
        .await
        .expect("seeding an executable");
}

/// One compiled file a compilation carries.
fn executable_row(filename: &str, digest: &str) -> ExecutableRow {
    ExecutableRow {
        submission_id: SubmissionId(SUBMISSION),
        dataset_id: DatasetId(DATASET),
        filename: filename.to_string(),
        digest: digest.parse().expect("a valid digest"),
    }
}

/// A Compilation batch carrying exactly the given executable set.
fn compilation_batch(executables: Vec<ExecutableRow>) -> ObjectWrite {
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
struct StoredExecutable {
    filename: String,
    digest: String,
}

/// The executables the database holds for the object, in filename order.
async fn stored_executables(connection: &mut PgConnection) -> Vec<StoredExecutable> {
    sqlx::query_as::<_, StoredExecutable>(
        "SELECT filename::text AS filename, digest::text AS digest \
         FROM executables WHERE submission_id = $1 AND dataset_id = $2 \
         ORDER BY filename",
    )
    .bind(SUBMISSION)
    .bind(DATASET)
    .fetch_all(connection)
    .await
    .expect("reading the stored executables")
}

#[derive(Debug, FromRow)]
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

#[derive(Debug, FromRow)]
struct StoredResult {
    compilation_outcome: Option<String>,
    compilation_text: Vec<String>,
    compilation_tries: i32,
    evaluation_outcome: Option<String>,
    evaluation_tries: i32,
}

async fn stored_evaluations(connection: &mut PgConnection) -> Vec<StoredEvaluation> {
    sqlx::query_as::<_, StoredEvaluation>(
        "SELECT testcase_id, outcome, text, admin_text, execution_time, \
                execution_wall_clock_time, execution_memory, evaluation_shard, \
                evaluation_sandbox_paths, evaluation_sandbox_digests \
         FROM evaluations WHERE submission_id = $1 AND dataset_id = $2 \
         ORDER BY testcase_id",
    )
    .bind(SUBMISSION)
    .bind(DATASET)
    .fetch_all(connection)
    .await
    .expect("reading the stored evaluations")
}

async fn stored_result(connection: &mut PgConnection) -> StoredResult {
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

/// Two testcases evaluated: both rows land, the result row is written, and the
/// completion rule stamps evaluation_outcome = 'ok'.
#[tokio::test]
async fn two_evaluations_complete_the_result() {
    let Some((mut base, mut connection)) = open().await else {
        return;
    };
    let written = batch(vec![evaluation_row(TESTCASE_A), evaluation_row(TESTCASE_B)]);
    commit(&mut connection, &[written])
        .await
        .expect("committing two evaluation rows");

    let stored = stored_evaluations(&mut connection).await;
    assert_eq!(stored.len(), 2, "both testcases are stored");
    assert_eq!(stored[0].testcase_id, TESTCASE_A);
    assert_eq!(stored[0].text, vec!["en: right", "th: ถูกต้อง"]);
    assert_eq!(
        stored[0].evaluation_sandbox_paths,
        Some(vec!["/tmp/a".to_string(), "/tmp/b".to_string()])
    );
    assert_eq!(stored[0].evaluation_sandbox_digests, None);
    assert_eq!(stored[0].outcome.as_deref(), Some("1.0"));
    assert_eq!(stored[0].admin_text, None);
    assert_eq!(stored[0].execution_time, Some(0.1));
    assert_eq!(stored[0].execution_wall_clock_time, Some(0.2));
    assert_eq!(stored[0].execution_memory, Some(1024));
    assert_eq!(stored[0].evaluation_shard, Some(0));
    assert_eq!(stored[1].testcase_id, TESTCASE_B);
    assert_eq!(stored[1].text, vec!["en: right", "th: ถูกต้อง"]);

    let result = stored_result(&mut connection).await;
    assert_eq!(result.compilation_outcome, None);
    assert!(result.compilation_text.is_empty());
    assert_eq!(result.compilation_tries, 0);
    assert_eq!(result.evaluation_tries, 3);
    assert_eq!(result.evaluation_outcome.as_deref(), Some("ok"));

    drop(connection);
    schema_check::drop_database(&mut base, CHECK_DATABASE).await;
}

/// One of two testcases evaluated: the completion rule must NOT fire.
#[tokio::test]
async fn one_of_two_testcases_leaves_outcome_null() {
    let Some((mut base, mut connection)) = open().await else {
        return;
    };
    let written = batch(vec![evaluation_row(TESTCASE_A)]);
    commit(&mut connection, &[written])
        .await
        .expect("committing one evaluation row");

    let stored = stored_evaluations(&mut connection).await;
    assert_eq!(stored.len(), 1, "the single testcase is stored");
    assert_eq!(stored[0].testcase_id, TESTCASE_A);

    let result = stored_result(&mut connection).await;
    assert_eq!(
        result.evaluation_outcome, None,
        "one row is not the whole dataset",
    );

    drop(connection);
    schema_check::drop_database(&mut base, CHECK_DATABASE).await;
}

/// A duplicate evaluation row in the batch is tolerated: the other rows land
/// and the call returns Ok.
#[tokio::test]
async fn a_duplicate_row_does_not_abort_the_batch() {
    let Some((mut base, mut connection)) = open().await else {
        return;
    };
    let written = batch(vec![
        evaluation_row(TESTCASE_A),
        evaluation_row(TESTCASE_A), // duplicate within the batch
        evaluation_row(TESTCASE_B),
    ]);
    commit(&mut connection, &[written])
        .await
        .expect("a duplicate must not abort the batch");

    let stored = stored_evaluations(&mut connection).await;
    assert_eq!(
        stored.len(),
        2,
        "the duplicate is dropped, the others remain"
    );
    assert_eq!(stored[0].testcase_id, TESTCASE_A);
    assert_eq!(stored[0].text, vec!["en: right", "th: ถูกต้อง"]);
    assert_eq!(stored[1].testcase_id, TESTCASE_B);
    assert_eq!(stored[1].execution_memory, Some(1024));

    drop(connection);
    schema_check::drop_database(&mut base, CHECK_DATABASE).await;
}

/// A batch's audit rows come back from the commit instead of being stored: this
/// connection cannot compute the chain, so the caller appends them through the
/// one writer that can, and nothing reaches `audit_log` from here.
#[tokio::test]
async fn a_batch_hands_its_audit_rows_back() {
    let Some((mut base, mut connection)) = open().await else {
        return;
    };
    let mut written = batch(vec![evaluation_row(TESTCASE_A), evaluation_row(TESTCASE_B)]);
    written.audit = vec![audit_row("evaluate")];

    let returned = commit(&mut connection, &[written])
        .await
        .expect("the rows commit and hand their audit back");

    assert_eq!(returned.len(), 1, "the batch's audit row comes back");
    assert_eq!(returned[0].verb.as_str(), "evaluate");
    assert_eq!(returned[0].entity.as_str(), "evaluations");
    let stored = stored_evaluations(&mut connection).await;
    assert_eq!(stored.len(), 2, "the data rows still landed");

    drop(connection);
    schema_check::drop_database(&mut base, CHECK_DATABASE).await;
}

/// A recompilation replaces the whole executable set: the stale old.bin is
/// cleared and only new.bin remains.
#[tokio::test]
async fn a_recompilation_replaces_the_executable_set() {
    let (mut base, mut connection) = require_open().await;
    seed_executable(&mut connection, "old.bin", OLD_DIGEST).await;

    let written = compilation_batch(vec![executable_row("new.bin", NEW_DIGEST)]);
    commit(&mut connection, &[written])
        .await
        .expect("committing a recompilation");

    let stored = stored_executables(&mut connection).await;
    assert_eq!(stored.len(), 1, "only the new executable remains");
    assert_eq!(stored[0].filename, "new.bin");
    assert_eq!(stored[0].digest, NEW_DIGEST);

    drop(connection);
    schema_check::drop_database(&mut base, CHECK_DATABASE).await;
}

/// A compilation with no executables still clears the set: the DELETE runs even
/// when the new set is empty.
#[tokio::test]
async fn a_compilation_with_no_executables_clears_the_set() {
    let (mut base, mut connection) = require_open().await;
    seed_executable(&mut connection, "old.bin", OLD_DIGEST).await;

    let written = compilation_batch(Vec::new());
    commit(&mut connection, &[written])
        .await
        .expect("committing a compilation with no executables");

    let stored = stored_executables(&mut connection).await;
    assert!(stored.is_empty(), "the executable set is cleared");

    drop(connection);
    schema_check::drop_database(&mut base, CHECK_DATABASE).await;
}

/// An Evaluation write must not clear the executable set: the DELETE runs only
/// for Compilation writes.
#[tokio::test]
async fn an_evaluation_write_keeps_the_executable_set() {
    let (mut base, mut connection) = require_open().await;
    seed_executable(&mut connection, "old.bin", OLD_DIGEST).await;

    let written = batch(Vec::new());
    commit(&mut connection, &[written])
        .await
        .expect("committing an evaluation write");

    let stored = stored_executables(&mut connection).await;
    assert_eq!(stored.len(), 1, "the executable survives");
    assert_eq!(stored[0].filename, "old.bin");
    assert_eq!(stored[0].digest, OLD_DIGEST, "the digest is unchanged");

    drop(connection);
    schema_check::drop_database(&mut base, CHECK_DATABASE).await;
}
