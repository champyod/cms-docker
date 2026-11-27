//! Operation builders, seeding and readers shared by the live operation tests.

use cms_db::Session;
use cms_evaluation::{
    compilation_priority, evaluation_priority, process_operation, Evaluation, PlannedOperation,
    WorkerDispatcher,
};
use cms_proto::{Operation, OperationKind};
use sqlx::postgres::PgConnection;
use sqlx::{AssertSqlSafe, Connection, FromRow};
use tokio::runtime::Handle;

use crate::fixture::{Fixture, DATASET, SECRET, SUBMISSION, TESTCASE, USER_TEST};

/// Seeds a submission result with the given compilation state.
pub async fn seed_result(session: &Session, outcome: Option<&str>, tries: i32) {
    let mut transaction = session.begin().await.expect("beginning the result seed");
    let outcome = outcome
        .map(|value| format!("'{value}'"))
        .unwrap_or_else(|| "NULL".to_owned());
    sqlx::raw_sql(AssertSqlSafe(format!(
        "INSERT INTO submission_results (submission_id, dataset_id, compilation_outcome, compilation_tries) \
         VALUES ({SUBMISSION}, {DATASET}, {outcome}, {tries})"
    )))
    .execute(transaction.connection())
    .await
    .expect("seeding the submission result");
    transaction.commit().await.expect("committing the seed");
}

/// Seeds the other testcase's evaluation, so this one completes the dataset.
pub async fn seed_evaluation(session: &Session) {
    let mut transaction = session
        .begin()
        .await
        .expect("beginning the evaluation seed");
    sqlx::raw_sql(AssertSqlSafe(format!(
        "INSERT INTO evaluations (submission_id, dataset_id, testcase_id, outcome) \
         VALUES ({SUBMISSION}, {DATASET}, {}, 'ok')",
        TESTCASE + 1
    )))
    .execute(transaction.connection())
    .await
    .expect("seeding the other evaluation");
    transaction.commit().await.expect("committing the seed");
}

/// Runs one queued submission operation through the whole loop.
pub async fn run_one(
    evaluation: &Evaluation,
    dispatcher: &mut WorkerDispatcher,
    scoring: &mut Option<cms_svc::Client>,
) {
    let (queued, timestamp) = evaluation
        .pop()
        .expect("the queue is usable")
        .expect("the operation is queued");
    process_operation(evaluation, dispatcher, scoring, queued, timestamp)
        .await
        .expect("the operation completes");
}

/// The stored compilation pair: outcome and try count.
#[derive(Debug, FromRow)]
pub struct StoredCompilation {
    pub outcome: Option<String>,
    pub tries: i32,
}

pub async fn stored_compilation(connection: &mut PgConnection) -> StoredCompilation {
    sqlx::query_as::<_, StoredCompilation>(
        "SELECT compilation_outcome::text AS outcome, compilation_tries AS tries \
         FROM submission_results WHERE submission_id = $1 AND dataset_id = $2",
    )
    .bind(SUBMISSION)
    .bind(DATASET)
    .fetch_one(connection)
    .await
    .expect("reading the stored compilation")
}

pub async fn connection(fixture: &Fixture) -> PgConnection {
    let mut connection = PgConnection::connect(fixture.url())
        .await
        .expect("connecting with the test search path");
    sqlx::raw_sql(AssertSqlSafe(format!(
        "SET search_path TO {}",
        fixture.schema()
    )))
    .execute(&mut connection)
    .await
    .expect("selecting the test schema");
    connection
}

/// The daemon context over the test's pooled session.
pub fn evaluation(fixture: &Fixture, scoring: Option<String>) -> Evaluation {
    Evaluation::new(
        fixture.session(),
        Handle::current(),
        scoring,
        Some(SECRET.to_owned()),
    )
}

/// One operation of `kind` on the fixture submission, with the right priority.
pub fn submission_operation(
    kind: OperationKind,
    codename: Option<&str>,
    tries: i32,
) -> PlannedOperation {
    PlannedOperation {
        operation: Operation {
            kind,
            object_id: i64::from(SUBMISSION),
            dataset_id: i64::from(DATASET),
            testcase_codename: codename.map(str::to_owned),
            archive_sandbox: false,
        },
        priority: if kind == OperationKind::Compilation {
            compilation_priority(true, tries)
        } else {
            evaluation_priority(true, tries)
        },
        timestamp: chrono::NaiveDate::from_ymd_opt(2026, 1, 1)
            .and_then(|date| date.and_hms_opt(0, 0, 0))
            .expect("a valid fixture time"),
    }
}

/// One user-test compilation operation on the fixture user test.
pub fn user_test_operation() -> PlannedOperation {
    PlannedOperation {
        operation: Operation {
            kind: OperationKind::UserTestCompilation,
            object_id: i64::from(USER_TEST),
            dataset_id: i64::from(DATASET),
            testcase_codename: None,
            archive_sandbox: false,
        },
        priority: compilation_priority(true, 0),
        timestamp: chrono::NaiveDate::from_ymd_opt(2026, 1, 1)
            .and_then(|date| date.and_hms_opt(0, 0, 0))
            .expect("a valid fixture time"),
    }
}
