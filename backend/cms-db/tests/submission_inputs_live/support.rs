//! Fixture schema and seed helpers for the `submission_inputs` live tests.
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
pub const SUBMISSION: i32 = 1;
pub const DATASET: i32 = 20;
pub const OTHER_DATASET: i32 = 21;
pub const MISSING_SUBMISSION: i32 = 999;
pub const MISSING_DATASET: i32 = 998;

const CONTEST_LANGUAGES: &[&str] = &["C11", "C++17", "Python3"];
const DECOY_LANGUAGES: &[&str] = &["Rust"];

/// Every table the reads name, as `TEMP` tables so each test owns its own copy.
const SCHEMA: &[&str] = &[
    "CREATE TEMP TABLE contests (id integer PRIMARY KEY, languages varchar[] NOT NULL DEFAULT '{}')",
    "CREATE TEMP TABLE tasks (id integer PRIMARY KEY, active_dataset_id integer)",
    "CREATE TEMP TABLE participations (id integer PRIMARY KEY, contest_id integer NOT NULL)",
    "CREATE TEMP TABLE datasets (id integer PRIMARY KEY, task_id integer NOT NULL, task_type varchar NOT NULL DEFAULT 'Batch', task_type_parameters jsonb NOT NULL DEFAULT '{}', score_type varchar NOT NULL DEFAULT 'Sum', score_type_parameters jsonb NOT NULL DEFAULT '0', time_limit double precision, memory_limit bigint)",
    "CREATE TEMP TABLE submissions (id integer PRIMARY KEY, opaque_id bigint NOT NULL DEFAULT 0, task_id integer NOT NULL, participation_id integer NOT NULL, timestamp timestamp NOT NULL DEFAULT '2026-01-01', language varchar, comment varchar NOT NULL DEFAULT '', official boolean NOT NULL DEFAULT true)",
    "CREATE TEMP TABLE submission_results (submission_id integer NOT NULL, dataset_id integer NOT NULL, compilation_outcome varchar, compilation_tries integer NOT NULL DEFAULT 0, evaluation_outcome varchar, evaluation_tries integer NOT NULL DEFAULT 0, score double precision, score_details jsonb, public_score double precision, public_score_details jsonb, ranking_score_details varchar[], PRIMARY KEY (submission_id, dataset_id))",
    "CREATE TEMP TABLE testcases (id integer PRIMARY KEY, dataset_id integer NOT NULL, codename varchar NOT NULL DEFAULT 'case', public boolean NOT NULL DEFAULT false, input varchar NOT NULL, output varchar NOT NULL)",
    "CREATE TEMP TABLE managers (id integer PRIMARY KEY, dataset_id integer NOT NULL, filename varchar NOT NULL, digest varchar NOT NULL)",
    "CREATE TEMP TABLE files (id integer PRIMARY KEY, submission_id integer NOT NULL, filename varchar NOT NULL, digest varchar NOT NULL)",
    "CREATE TEMP TABLE executables (id integer PRIMARY KEY, submission_id integer NOT NULL, dataset_id integer NOT NULL, filename varchar NOT NULL, digest varchar NOT NULL)",
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
        .expect("CMS_DB_TEST_URL must name a scratch PostgreSQL database for submission_inputs")
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
    seed_submission(connection).await;
    seed_managers(connection).await;
    seed_testcases(connection).await;
    seed_files(connection).await;
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
        &format!("INSERT INTO tasks (id) VALUES ({TASK}), ({OTHER_TASK})"),
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

/// The submission and its dataset.
async fn seed_submission(connection: &mut PgConnection) {
    exec(
        connection,
        &format!(
            "INSERT INTO submissions (id, task_id, participation_id, language, comment) \
             VALUES ({SUBMISSION}, {TASK}, {PARTICIPATION}, 'C++17', 'a submission')"
        ),
    )
    .await;
    exec(
        connection,
        &format!("INSERT INTO datasets (id, task_id) VALUES ({DATASET}, {TASK})"),
    )
    .await;
}

/// The dataset's two managers.
async fn seed_managers(connection: &mut PgConnection) {
    exec(
        connection,
        &format!(
            "INSERT INTO managers (id, dataset_id, filename, digest) VALUES \
             (1, {DATASET}, 'manager', '{}'), (2, {DATASET}, 'checker', '{}')",
            digest(1),
            digest(2)
        ),
    )
    .await;
}

/// The dataset's two testcases.
async fn seed_testcases(connection: &mut PgConnection) {
    exec(
        connection,
        &format!(
            "INSERT INTO testcases (id, dataset_id, codename, input, output) VALUES \
             (1, {DATASET}, 'one', '{}', '{}'), (2, {DATASET}, 'two', '{}', '{}')",
            digest(3),
            digest(4),
            digest(5),
            digest(6)
        ),
    )
    .await;
}

/// The submission's two uploaded files.
async fn seed_files(connection: &mut PgConnection) {
    exec(
        connection,
        &format!(
            "INSERT INTO files (id, submission_id, filename, digest) VALUES \
             (1, {SUBMISSION}, 'source.%l', '{}'), (2, {SUBMISSION}, 'extra.txt', '{}')",
            digest(7),
            digest(8)
        ),
    )
    .await;
}

/// Adds the result row and the two executables it produced.
pub async fn add_result(connection: &mut PgConnection) {
    exec(
        connection,
        &format!(
            "INSERT INTO submission_results (submission_id, dataset_id, compilation_tries) \
             VALUES ({SUBMISSION}, {DATASET}, 2)"
        ),
    )
    .await;
    exec(
        connection,
        &format!(
            "INSERT INTO executables (id, submission_id, dataset_id, filename, digest) VALUES \
             (1, {SUBMISSION}, {DATASET}, 'a.out', '{}'), \
             (2, {SUBMISSION}, {DATASET}, 'stub', '{}')",
            digest(9),
            digest(10)
        ),
    )
    .await;
}

/// Adds a dataset owned by another task, for the refusal test.
pub async fn add_other_dataset(connection: &mut PgConnection) {
    exec(
        connection,
        &format!("INSERT INTO datasets (id, task_id) VALUES ({OTHER_DATASET}, {OTHER_TASK})"),
    )
    .await;
}
