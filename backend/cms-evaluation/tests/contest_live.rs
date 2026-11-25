//! The contest sweep against a real server.
//!
//! RUN: CMS_DB_TEST_URL=postgres://cmsuser:***@127.0.0.1:5432/cmsdb_test \
//!        cargo test -p cms-evaluation --test contest_live

use chrono::NaiveDateTime;
use cms_evaluation::contest_operations;
use cms_proto::{OperationKind, PRIORITY_EXTRA_LOW, PRIORITY_HIGH, PRIORITY_MEDIUM};
use sqlx::postgres::PgConnection;
use sqlx::AssertSqlSafe;

#[allow(dead_code)]
#[path = "../../cms-db/tests/support/util_db.rs"]
mod util_db;

use util_db::{digest, open, seed_datasets};

const CONTEST: i32 = 1;
const ACTIVE: i64 = 20;
const AUTOJUDGE: i64 = 21;

fn at(second: u32) -> NaiveDateTime {
    NaiveDateTime::parse_from_str(
        &format!("2026-01-01 00:00:{second:02}"),
        "%Y-%m-%d %H:%M:%S",
    )
    .expect("a valid fixture timestamp")
}

async fn execute(connection: &mut PgConnection, statement: &'static str) {
    sqlx::raw_sql(AssertSqlSafe(statement))
        .execute(&mut *connection)
        .await
        .expect("seeding the contest fixture");
}

async fn seed(connection: &mut PgConnection) {
    seed_datasets(connection).await;
    for statement in [
        "ALTER TABLE user_tests ADD COLUMN participation_id integer NOT NULL DEFAULT 100",
        "ALTER TABLE user_tests ADD COLUMN timestamp timestamp NOT NULL DEFAULT '2026-01-01'",
        "ALTER TABLE user_tests ADD COLUMN language varchar",
        "ALTER TABLE user_test_results ADD COLUMN compilation_outcome varchar",
        "ALTER TABLE user_test_results ADD COLUMN compilation_tries integer NOT NULL DEFAULT 0",
        "ALTER TABLE user_test_results ADD COLUMN evaluation_outcome varchar",
        "ALTER TABLE user_test_results ADD COLUMN evaluation_tries integer NOT NULL DEFAULT 0",
        "INSERT INTO datasets (id, task_id, description) VALUES (24, 11, 'other contest')",
        "UPDATE tasks SET active_dataset_id = 24 WHERE id = 11",
    ] {
        execute(connection, statement).await;
    }
    execute(
        connection,
        "INSERT INTO testcases (id, dataset_id, codename, input, output) VALUES
            (40, 20, 'alpha',
             '0000000000000000000000000000000000000040',
             '0000000000000000000000000000000000000041'),
            (41, 20, 'beta',
             '0000000000000000000000000000000000000042',
             '0000000000000000000000000000000000000043'),
            (42, 21, 'auto',
             '0000000000000000000000000000000000000044',
             '0000000000000000000000000000000000000045'),
            (43, 24, 'other',
             '0000000000000000000000000000000000000046',
             '0000000000000000000000000000000000000047')",
    )
    .await;
    execute(
        connection,
        "INSERT INTO submissions (id, opaque_id, task_id, participation_id, timestamp) VALUES
            (300, 1, 10, 100, '2026-01-01 00:00:01'),
            (301, 2, 10, 100, '2026-01-01 00:00:02'),
            (304, 3, 10, 100, '2026-01-01 00:00:03'),
            (305, 6, 10, 100, '2026-01-01 00:00:03'),
            (306, 4, 10, 100, '2026-01-01 00:00:04'),
            (308, 5, 11, 101, '2026-01-01 00:00:05')",
    )
    .await;
    execute(
        connection,
        "INSERT INTO submission_results
            (submission_id, dataset_id, compilation_outcome, evaluation_outcome)
         VALUES
            (301, 20, NULL, NULL),
            (304, 20, 'ok', NULL),
            (305, 20, 'ok', NULL),
            (306, 21, 'ok', NULL),
            (308, 24, 'ok', NULL)",
    )
    .await;
    execute(
        connection,
        "INSERT INTO evaluations (id, submission_id, dataset_id, testcase_id, outcome, text)
         VALUES (50, 305, 20, 40, '1', ARRAY['right'])",
    )
    .await;
    seed_user_tests(connection).await;
}

async fn seed_user_tests(connection: &mut PgConnection) {
    let statement = format!(
        "INSERT INTO user_tests (id, task_id, input, participation_id, timestamp, language) VALUES
            (400, 10, '{input}', 100, '2026-01-01 00:00:06', 'cpp20'),
            (402, 10, '{input}', 100, '2026-01-01 00:00:07', 'cpp20')",
        input = digest(1)
    );
    sqlx::raw_sql(AssertSqlSafe(statement))
        .execute(&mut *connection)
        .await
        .expect("seeding user tests");
    execute(
        connection,
        "INSERT INTO user_test_results
            (user_test_id, dataset_id, compilation_outcome, evaluation_outcome)
         VALUES (402, 20, 'ok', NULL)",
    )
    .await;
}

fn expected() -> Vec<cms_evaluation::PlannedOperation> {
    let mut operations = Vec::new();
    let mut push = |kind, object_id, dataset_id, codename: Option<&str>, priority, second| {
        operations.push(cms_evaluation::PlannedOperation {
            operation: cms_proto::Operation {
                kind,
                object_id,
                dataset_id,
                testcase_codename: codename.map(str::to_string),
                archive_sandbox: false,
            },
            priority,
            timestamp: at(second),
        });
    };
    push(
        OperationKind::Compilation,
        300,
        ACTIVE,
        None,
        PRIORITY_HIGH,
        1,
    );
    push(
        OperationKind::Compilation,
        300,
        AUTOJUDGE,
        None,
        PRIORITY_EXTRA_LOW,
        1,
    );
    push(
        OperationKind::Compilation,
        301,
        ACTIVE,
        None,
        PRIORITY_HIGH,
        2,
    );
    push(
        OperationKind::Compilation,
        301,
        AUTOJUDGE,
        None,
        PRIORITY_EXTRA_LOW,
        2,
    );
    push(
        OperationKind::Compilation,
        304,
        AUTOJUDGE,
        None,
        PRIORITY_EXTRA_LOW,
        3,
    );
    push(
        OperationKind::Evaluation,
        304,
        ACTIVE,
        Some("alpha"),
        PRIORITY_MEDIUM,
        3,
    );
    push(
        OperationKind::Evaluation,
        304,
        ACTIVE,
        Some("beta"),
        PRIORITY_MEDIUM,
        3,
    );
    push(
        OperationKind::Evaluation,
        305,
        ACTIVE,
        Some("beta"),
        PRIORITY_MEDIUM,
        3,
    );
    push(
        OperationKind::Compilation,
        305,
        AUTOJUDGE,
        None,
        PRIORITY_EXTRA_LOW,
        3,
    );
    push(
        OperationKind::Compilation,
        306,
        ACTIVE,
        None,
        PRIORITY_HIGH,
        4,
    );
    push(
        OperationKind::Evaluation,
        306,
        AUTOJUDGE,
        Some("auto"),
        PRIORITY_EXTRA_LOW,
        4,
    );
    push(
        OperationKind::UserTestCompilation,
        400,
        ACTIVE,
        None,
        PRIORITY_HIGH,
        6,
    );
    push(
        OperationKind::UserTestCompilation,
        400,
        AUTOJUDGE,
        None,
        PRIORITY_EXTRA_LOW,
        6,
    );
    push(
        OperationKind::UserTestCompilation,
        402,
        AUTOJUDGE,
        None,
        PRIORITY_EXTRA_LOW,
        7,
    );
    push(
        OperationKind::UserTestEvaluation,
        402,
        ACTIVE,
        None,
        PRIORITY_MEDIUM,
        7,
    );
    operations
}

fn sorted(
    mut operations: Vec<cms_evaluation::PlannedOperation>,
) -> Vec<cms_evaluation::PlannedOperation> {
    operations.sort_by(|left, right| {
        (
            left.timestamp,
            left.operation.object_id,
            left.operation.dataset_id,
            left.operation.testcase_codename.as_deref(),
        )
            .cmp(&(
                right.timestamp,
                right.operation.object_id,
                right.operation.dataset_id,
                right.operation.testcase_codename.as_deref(),
            ))
    });
    operations
}

#[tokio::test]
async fn contest_operations_returns_the_exact_submission_and_user_test_work() {
    let url = std::env::var("CMS_DB_TEST_URL")
        .expect("CMS_DB_TEST_URL must name a scratch PostgreSQL database");
    let mut connection = open(&url).await;
    seed(&mut connection).await;

    let planned = contest_operations(&mut connection, Some(CONTEST))
        .await
        .expect("sweeping the contest");

    assert_eq!(sorted(planned), sorted(expected()));
}

#[tokio::test]
async fn by_id_reads_return_only_the_named_object() {
    let url = std::env::var("CMS_DB_TEST_URL")
        .expect("CMS_DB_TEST_URL must name a scratch PostgreSQL database");
    let mut connection = open(&url).await;
    seed(&mut connection).await;

    let submission = cms_evaluation::submission_operations_by_id(&mut connection, 305)
        .await
        .expect("submission operations");
    assert_eq!(submission.len(), 2);
    assert!(submission
        .iter()
        .all(|planned| planned.operation.object_id == 305));

    let user_test = cms_evaluation::user_test_operations_by_id(&mut connection, 402)
        .await
        .expect("user test operations");
    assert_eq!(user_test.len(), 2);
    assert!(user_test
        .iter()
        .all(|planned| planned.operation.object_id == 402));
}

#[tokio::test]
async fn a_none_contest_includes_the_other_contest_and_a_specific_one_excludes_it() {
    let url = std::env::var("CMS_DB_TEST_URL")
        .expect("CMS_DB_TEST_URL must name a scratch PostgreSQL database");
    let mut connection = open(&url).await;
    seed(&mut connection).await;

    let all = contest_operations(&mut connection, None)
        .await
        .expect("sweeping every contest");
    assert!(all.iter().any(|planned| planned.operation.object_id == 308));
    let other = contest_operations(&mut connection, Some(2))
        .await
        .expect("sweeping the other contest");
    assert!(!other.is_empty());
    assert!(!other
        .iter()
        .any(|planned| planned.operation.object_id == 300));
}
