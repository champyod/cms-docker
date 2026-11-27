//! Fixture schema and seed helpers for the `user_test_inputs` live tests.
//!
//! Every table is `TEMP`, so each test owns its own copy in its own connection.

use std::collections::BTreeMap;

use cms_db::FileDigest;
use sqlx::postgres::PgConnection;
use sqlx::{AssertSqlSafe, Connection};

pub const CONTEST: i32 = 1;
const DECOY_CONTEST: i32 = 2;
pub const PARTICIPATION: i32 = 100;
const DECOY_PARTICIPATION: i32 = 101;
pub const TASK: i32 = 10;
const OTHER_TASK: i32 = 11;
pub const USER_TEST: i32 = 1;
pub const DATASET: i32 = 20;
pub const OTHER_DATASET: i32 = 21;
pub const MISSING_USER_TEST: i32 = 999;
pub const MISSING_DATASET: i32 = 998;

const CONTEST_LANGUAGES: &[&str] = &["C11", "C++17"];
const DECOY_LANGUAGES: &[&str] = &["Rust"];

/// Every table the reads name, as `TEMP` tables so each test owns its own copy.
const SCHEMA: &[&str] = &[
    "CREATE TEMP TABLE contests (id integer PRIMARY KEY, languages varchar[] NOT NULL DEFAULT '{}')",
    "CREATE TEMP TABLE tasks (id integer PRIMARY KEY, active_dataset_id integer)",
    "CREATE TEMP TABLE participations (id integer PRIMARY KEY, contest_id integer NOT NULL)",
    "CREATE TEMP TABLE datasets (id integer PRIMARY KEY, task_id integer NOT NULL, task_type varchar NOT NULL DEFAULT 'Batch', task_type_parameters jsonb NOT NULL DEFAULT '{}', score_type varchar NOT NULL DEFAULT 'Sum', score_type_parameters jsonb NOT NULL DEFAULT '0', time_limit double precision, memory_limit bigint)",
    "CREATE TEMP TABLE managers (id integer PRIMARY KEY, dataset_id integer NOT NULL, filename varchar NOT NULL, digest varchar NOT NULL)",
    "CREATE TEMP TABLE user_tests (id integer PRIMARY KEY, participation_id integer NOT NULL, task_id integer NOT NULL, timestamp timestamp NOT NULL DEFAULT '2026-01-01', language varchar, input varchar NOT NULL)",
    "CREATE TEMP TABLE user_test_files (id integer PRIMARY KEY, user_test_id integer NOT NULL, filename varchar NOT NULL, digest varchar NOT NULL)",
    "CREATE TEMP TABLE user_test_managers (id integer PRIMARY KEY, user_test_id integer NOT NULL, filename varchar NOT NULL, digest varchar NOT NULL)",
    "CREATE TEMP TABLE user_test_results (user_test_id integer NOT NULL, dataset_id integer NOT NULL, compilation_outcome varchar, compilation_text varchar[] NOT NULL DEFAULT '{}', compilation_tries integer NOT NULL DEFAULT 0, compilation_stdout varchar, compilation_stderr varchar, compilation_time double precision, compilation_wall_clock_time double precision, compilation_memory bigint, compilation_shard integer, compilation_sandbox_paths varchar[], compilation_sandbox_digests varchar[], evaluation_outcome varchar, evaluation_text varchar[] NOT NULL DEFAULT '{}', evaluation_tries integer NOT NULL DEFAULT 0, execution_time double precision, execution_wall_clock_time double precision, execution_memory bigint, evaluation_shard integer, evaluation_sandbox_paths varchar[], evaluation_sandbox_digests varchar[], output varchar, PRIMARY KEY (user_test_id, dataset_id))",
    "CREATE TEMP TABLE user_test_executables (id integer PRIMARY KEY, user_test_id integer NOT NULL, dataset_id integer NOT NULL, filename varchar NOT NULL, digest varchar NOT NULL)",
];

/// A distinct valid `DIGEST` value for each named byte.
fn digest(value: u8) -> String {
    format!("{value:040x}")
}

/// The `FileDigest` a fixture digest is read back as.
pub fn file_digest(value: u8) -> FileDigest {
    digest(value).parse().expect("a valid fixture digest")
}

/// An expected `filename -> digest` map, built independently of the read.
pub fn expected(pairs: &[(&str, u8)]) -> BTreeMap<String, FileDigest> {
    pairs
        .iter()
        .map(|&(name, value)| (name.to_string(), file_digest(value)))
        .collect()
}

/// The contest languages every assertion checks against.
pub fn expected_languages() -> Vec<String> {
    CONTEST_LANGUAGES.iter().map(|s| (*s).to_string()).collect()
}

/// A PostgreSQL array literal of string values.
fn sql_array(values: &[&str]) -> String {
    let quoted: Vec<String> = values.iter().map(|value| format!("'{value}'")).collect();
    format!("ARRAY[{}]", quoted.join(", "))
}

/// Runs one fixture statement, refusing a failure instead of skipping it.
async fn exec(connection: &mut PgConnection, sql: &str) {
    sqlx::raw_sql(AssertSqlSafe(sql))
        .execute(&mut *connection)
        .await
        .expect("running fixture SQL");
}

/// The scratch URL; a live test fails by name when it is absent.
fn url() -> String {
    std::env::var("CMS_DB_TEST_URL")
        .expect("CMS_DB_TEST_URL must name a scratch PostgreSQL database for user_test_inputs")
}

/// A connection whose temp schema and all base rows are in place.
pub async fn setup() -> PgConnection {
    let mut connection = PgConnection::connect(&url())
        .await
        .expect("connecting to the scratch database");
    for statement in SCHEMA {
        exec(&mut connection, statement).await;
    }
    seed_base(&mut connection).await;
    connection
}

/// Every base row the reads return, so each test starts from the same fixture.
async fn seed_base(connection: &mut PgConnection) {
    seed_scaffolding(connection).await;
    seed_user_test(connection).await;
    seed_managers(connection).await;
    seed_user_test_files(connection).await;
}

/// Contests with their language lists, tasks, and the two participations.
async fn seed_scaffolding(connection: &mut PgConnection) {
    exec(
        connection,
        &format!(
            "INSERT INTO contests (id, languages) VALUES ({CONTEST}, {}), ({DECOY_CONTEST}, {})",
            sql_array(CONTEST_LANGUAGES),
            sql_array(DECOY_LANGUAGES)
        ),
    )
    .await;
    exec(
        connection,
        &format!("INSERT INTO tasks (id, active_dataset_id) VALUES ({TASK}, {DATASET}), ({OTHER_TASK}, {OTHER_DATASET})"),
    )
    .await;
    exec(
        connection,
        &format!(
            "INSERT INTO participations (id, contest_id) VALUES \
             ({PARTICIPATION}, {CONTEST}), ({DECOY_PARTICIPATION}, {DECOY_CONTEST})"
        ),
    )
    .await;
}

/// The user test and its dataset.
async fn seed_user_test(connection: &mut PgConnection) {
    exec(
        connection,
        &format!(
            "INSERT INTO user_tests (id, participation_id, task_id, language, input) \
             VALUES ({USER_TEST}, {PARTICIPATION}, {TASK}, 'C++17', '{}')",
            digest(1)
        ),
    )
    .await;
    exec(
        connection,
        &format!(
            "INSERT INTO datasets (id, task_id, time_limit, memory_limit) \
             VALUES ({DATASET}, {TASK}, 2.5, 268435456)"
        ),
    )
    .await;
}

/// The dataset's two managers.
async fn seed_managers(connection: &mut PgConnection) {
    exec(
        connection,
        &format!(
            "INSERT INTO managers (id, dataset_id, filename, digest) VALUES \
             (1, {DATASET}, 'grader.%l', '{}'), (2, {DATASET}, 'checker', '{}')",
            digest(2),
            digest(3)
        ),
    )
    .await;
}

/// The user test's uploaded file and its own manager.
async fn seed_user_test_files(connection: &mut PgConnection) {
    exec(
        connection,
        &format!(
            "INSERT INTO user_test_files (id, user_test_id, filename, digest) VALUES \
             (1, {USER_TEST}, 'source.cpp', '{}')",
            digest(4)
        ),
    )
    .await;
    exec(
        connection,
        &format!(
            "INSERT INTO user_test_managers (id, user_test_id, filename, digest) VALUES \
             (1, {USER_TEST}, 'own.cpp', '{}')",
            digest(5)
        ),
    )
    .await;
}

/// Adds the result row and the two executables it produced.
pub async fn add_result(connection: &mut PgConnection) {
    exec(
        connection,
        &format!(
            "INSERT INTO user_test_results (user_test_id, dataset_id, compilation_tries) \
             VALUES ({USER_TEST}, {DATASET}, 2)"
        ),
    )
    .await;
    exec(
        connection,
        &format!(
            "INSERT INTO user_test_executables (id, user_test_id, dataset_id, filename, digest) VALUES \
             (1, {USER_TEST}, {DATASET}, 'a.out', '{}'), \
             (2, {USER_TEST}, {DATASET}, 'stub', '{}')",
            digest(6),
            digest(7)
        ),
    )
    .await;
}
