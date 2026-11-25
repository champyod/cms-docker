//! The EvaluationService sweep reads against a real server.
//!
//! RUN: CMS_DB_TEST_URL=postgres://cmsuser:***@127.0.0.1:5432/cmsdb_test \
//!        cargo test -p cms-db --test evaluation_live

use chrono::NaiveDateTime;
use cms_db::{
    submission_compilations, submission_evaluations, user_test_compilations, user_test_evaluations,
    CompilationCandidate, DatasetId, EvaluationCandidate,
};
use sqlx::postgres::PgConnection;
use sqlx::AssertSqlSafe;
#[allow(dead_code)]
#[path = "support/util_db.rs"]
mod util_db;

use util_db::{digest, open, seed_datasets};

const CONTEST: i32 = 1;
const OTHER_CONTEST: i32 = 2;

const ACTIVE: i32 = 20;
const AUTOJUDGE: i32 = 21;

/// The instant a fixture row carries.
fn at(second: u32) -> NaiveDateTime {
    NaiveDateTime::parse_from_str(
        &format!("2026-01-01 00:00:{second:02}"),
        "%Y-%m-%d %H:%M:%S",
    )
    .expect("a valid fixture timestamp")
}

/// Extend the shared temp schema with the columns the sweep reads.
async fn add_evaluation_columns(connection: &mut PgConnection) {
    let statements = [
        "ALTER TABLE user_tests ADD COLUMN participation_id integer NOT NULL DEFAULT 100",
        "ALTER TABLE user_tests ADD COLUMN timestamp timestamp NOT NULL DEFAULT '2026-01-01'",
        "ALTER TABLE user_tests ADD COLUMN language varchar",
        "ALTER TABLE user_test_results ADD COLUMN compilation_outcome varchar",
        "ALTER TABLE user_test_results ADD COLUMN compilation_tries integer NOT NULL DEFAULT 0",
        "ALTER TABLE user_test_results ADD COLUMN evaluation_outcome varchar",
        "ALTER TABLE user_test_results ADD COLUMN evaluation_tries integer NOT NULL DEFAULT 0",
        "INSERT INTO datasets (id, task_id, description) VALUES (24, 11, 'other contest')",
        "UPDATE tasks SET active_dataset_id = 24 WHERE id = 11",
    ];
    for statement in statements {
        sqlx::raw_sql(AssertSqlSafe(statement))
            .execute(&mut *connection)
            .await
            .expect("extending the evaluation fixture");
    }
}

/// One task's testcases and the rows exercising every sweep branch.
async fn seed(connection: &mut PgConnection) {
    seed_datasets(connection).await;
    add_evaluation_columns(connection).await;
    sqlx::raw_sql(AssertSqlSafe(
        "INSERT INTO testcases (id, dataset_id, codename, public, input, output) VALUES
            (40, 20, 'alpha', true,
             '0000000000000000000000000000000000000040',
             '0000000000000000000000000000000000000041'),
            (41, 20, 'beta', false,
             '0000000000000000000000000000000000000042',
             '0000000000000000000000000000000000000043'),
            (42, 21, 'auto', true,
             '0000000000000000000000000000000000000044',
             '0000000000000000000000000000000000000045'),
            (43, 24, 'other', true,
             '0000000000000000000000000000000000000046',
             '0000000000000000000000000000000000000047')",
    ))
    .execute(&mut *connection)
    .await
    .expect("seeding testcases");
    sqlx::raw_sql(AssertSqlSafe(
        "INSERT INTO submissions (id, opaque_id, task_id, participation_id, timestamp) VALUES
            (300, 1, 10, 100, '2026-01-01 00:00:01'),
            (301, 2, 10, 100, '2026-01-01 00:00:02'),
            (302, 3, 10, 100, '2026-01-01 00:00:03'),
            (303, 4, 10, 100, '2026-01-01 00:00:04'),
            (304, 5, 10, 100, '2026-01-01 00:00:05'),
            (305, 6, 10, 100, '2026-01-01 00:00:06'),
            (306, 7, 10, 100, '2026-01-01 00:00:07'),
            (307, 8, 10, 100, '2026-01-01 00:00:08'),
            (308, 9, 11, 101, '2026-01-01 00:00:09')",
    ))
    .execute(&mut *connection)
    .await
    .expect("seeding submissions");
    sqlx::raw_sql(AssertSqlSafe(
        "INSERT INTO submission_results
            (submission_id, dataset_id, compilation_outcome, compilation_tries,
             evaluation_outcome, evaluation_tries)
         VALUES
            (301, 20, NULL, 0, NULL, 0),
            (302, 20, 'fail', 0, NULL, 0),
            (303, 20, NULL, 3, NULL, 0),
            (304, 20, 'ok', 0, NULL, 0),
            (305, 20, 'ok', 0, NULL, 0),
            (306, 21, 'ok', 0, NULL, 0),
            (307, 22, 'ok', 0, NULL, 0),
            (308, 24, 'ok', 0, NULL, 0)",
    ))
    .execute(&mut *connection)
    .await
    .expect("seeding submission results");
    sqlx::raw_sql(AssertSqlSafe(
        "INSERT INTO evaluations (id, submission_id, dataset_id, testcase_id, outcome, text)
         VALUES (50, 305, 20, 40, '1', ARRAY['right'])",
    ))
    .execute(&mut *connection)
    .await
    .expect("seeding the completed evaluation");
    seed_user_tests(connection).await;
}

async fn seed_user_tests(connection: &mut PgConnection) {
    let input = digest(1).to_string();
    let statement = format!(
        "INSERT INTO user_tests (id, task_id, input, participation_id, timestamp, language) VALUES
            (400, 10, '{input}', 100, '2026-01-01 00:00:11', 'cpp20'),
            (401, 10, '{input}', 100, '2026-01-01 00:00:12', 'cpp20'),
            (402, 10, '{input}', 100, '2026-01-01 00:00:13', 'cpp20'),
            (403, 10, '{input}', 100, '2026-01-01 00:00:14', 'cpp20'),
            (404, 11, '{input}', 101, '2026-01-01 00:00:15', 'cpp20')"
    );
    sqlx::raw_sql(AssertSqlSafe(statement))
        .execute(&mut *connection)
        .await
        .expect("seeding user tests");
    sqlx::raw_sql(AssertSqlSafe(
        "INSERT INTO user_test_results
            (user_test_id, dataset_id, compilation_outcome, compilation_tries,
             evaluation_outcome, evaluation_tries)
         VALUES
            (401, 20, NULL, 0, NULL, 0),
            (402, 20, 'ok', 0, NULL, 0),
            (403, 21, 'fail', 0, NULL, 0)",
    ))
    .execute(&mut *connection)
    .await
    .expect("seeding user test results");
}

fn compilation(
    object_id: i32,
    dataset_id: i32,
    second: u32,
    is_active: bool,
    tries: i32,
) -> CompilationCandidate {
    CompilationCandidate {
        object_id,
        dataset_id: DatasetId(dataset_id),
        timestamp: at(second),
        is_active,
        tries,
    }
}

fn evaluation(
    object_id: i32,
    dataset_id: i32,
    second: u32,
    is_active: bool,
    tries: i32,
    testcase_codename: Option<&str>,
) -> EvaluationCandidate {
    EvaluationCandidate {
        object_id,
        dataset_id: DatasetId(dataset_id),
        timestamp: at(second),
        is_active,
        tries,
        testcase_codename: testcase_codename.map(str::to_string),
    }
}

#[tokio::test]
async fn every_sweep_read_returns_its_contest_work_and_nothing_else() {
    let url = std::env::var("CMS_DB_TEST_URL")
        .expect("CMS_DB_TEST_URL must name a scratch PostgreSQL database");
    let mut connection = open(&url).await;
    seed(&mut connection).await;

    assert_eq!(
        submission_compilations(&mut connection, Some(CONTEST), None, 3)
            .await
            .expect("submission compilations"),
        vec![
            compilation(300, ACTIVE, 1, true, 0),
            compilation(300, AUTOJUDGE, 1, false, 0),
            compilation(301, ACTIVE, 2, true, 0),
            compilation(301, AUTOJUDGE, 2, false, 0),
            compilation(302, AUTOJUDGE, 3, false, 0),
            compilation(303, AUTOJUDGE, 4, false, 0),
            compilation(304, AUTOJUDGE, 5, false, 0),
            compilation(305, AUTOJUDGE, 6, false, 0),
            compilation(306, ACTIVE, 7, true, 0),
            compilation(307, ACTIVE, 8, true, 0),
            compilation(307, AUTOJUDGE, 8, false, 0),
        ]
    );
    assert_eq!(
        submission_evaluations(&mut connection, Some(CONTEST), None, 3)
            .await
            .expect("submission evaluations"),
        vec![
            evaluation(304, ACTIVE, 5, true, 0, Some("alpha")),
            evaluation(304, ACTIVE, 5, true, 0, Some("beta")),
            evaluation(305, ACTIVE, 6, true, 0, Some("beta")),
            evaluation(306, AUTOJUDGE, 7, false, 0, Some("auto")),
        ]
    );
    assert_eq!(
        user_test_compilations(&mut connection, Some(CONTEST), None, 3)
            .await
            .expect("user test compilations"),
        vec![
            compilation(400, ACTIVE, 11, true, 0),
            compilation(400, AUTOJUDGE, 11, false, 0),
            compilation(401, ACTIVE, 12, true, 0),
            compilation(401, AUTOJUDGE, 12, false, 0),
            compilation(402, AUTOJUDGE, 13, false, 0),
            compilation(403, ACTIVE, 14, true, 0),
        ]
    );
    assert_eq!(
        user_test_evaluations(&mut connection, Some(CONTEST), None, 3)
            .await
            .expect("user test evaluations"),
        vec![evaluation(402, ACTIVE, 13, true, 0, None)]
    );
}

#[tokio::test]
async fn a_contest_filter_excludes_the_other_contest_and_none_reads_every_contest() {
    let url = std::env::var("CMS_DB_TEST_URL")
        .expect("CMS_DB_TEST_URL must name a scratch PostgreSQL database");
    let mut connection = open(&url).await;
    seed(&mut connection).await;

    let filtered = submission_compilations(&mut connection, Some(OTHER_CONTEST), None, 3)
        .await
        .expect("other contest compilations");
    assert!(filtered.is_empty());
    let all = submission_compilations(&mut connection, None, None, 3)
        .await
        .expect("all contest compilations");
    assert!(!all.iter().any(|candidate| candidate.object_id == 308));
    assert!(all.iter().any(|candidate| candidate.object_id == 300));
    let all_evaluations = submission_evaluations(&mut connection, None, None, 3)
        .await
        .expect("all contest evaluations");
    assert!(all_evaluations
        .iter()
        .any(|candidate| candidate.object_id == 308));
}
