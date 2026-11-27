//! The private schema and base rows one evaluation operation test owns.

use sqlx::postgres::PgConnection;
use sqlx::AssertSqlSafe;

pub const CONTEST: i32 = 1;
pub const PARTICIPATION: i32 = 10;
pub const TASK: i32 = 20;
pub const DATASET: i32 = 30;
pub const SUBMISSION: i32 = 40;
pub const USER_TEST: i32 = 50;
pub const TESTCASE: i32 = 60;

pub const SCHEMA_PREFIX: &str = "evaluation_operation_live";

/// A private schema name, so tests running in parallel never share one.
///
/// The cargo default is a test thread per core, and every operation test in
/// this target calls `Fixture::required()`; a single fixed name made the second
/// `CREATE SCHEMA` fail with a duplicate-key error. The process id plus a
/// counter is unique per test without needing a random source.
pub fn schema_name() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    format!(
        "{SCHEMA_PREFIX}_{}_{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    )
}
/// The digest every input and output column carries.
pub fn digest(byte: u8) -> String {
    format!("{byte:040x}")
}

const TABLES: &[&str] = &[
    "CREATE DOMAIN compilation_outcome AS varchar CHECK (VALUE IN ('ok', 'fail'))",
    "CREATE DOMAIN evaluation_outcome AS varchar CHECK (VALUE = 'ok')",
    "CREATE TABLE contests (id integer PRIMARY KEY, languages varchar[] NOT NULL DEFAULT '{}')",
    "CREATE TABLE participations (
        id integer PRIMARY KEY,
        contest_id integer NOT NULL REFERENCES contests (id))",
    "CREATE TABLE contest_tasks (
        contest_id integer NOT NULL REFERENCES contests (id),
        task_id integer NOT NULL,
        PRIMARY KEY (contest_id, task_id))",
    "CREATE TABLE tasks (
        id integer PRIMARY KEY,
        name varchar NOT NULL DEFAULT 'task',
        active_dataset_id integer,
        allowed_languages varchar[],
        feedback_level varchar NOT NULL DEFAULT 'full')",
    "CREATE TABLE datasets (
        id integer PRIMARY KEY,
        task_id integer NOT NULL REFERENCES tasks (id),
        description varchar NOT NULL DEFAULT 'dataset',
        autojudge boolean NOT NULL DEFAULT true,
        time_limit double precision,
        memory_limit bigint,
        task_type varchar NOT NULL DEFAULT 'Batch',
        task_type_parameters jsonb NOT NULL DEFAULT '{}',
        score_type varchar NOT NULL DEFAULT 'Sum',
        score_type_parameters jsonb NOT NULL DEFAULT '0')",
    "CREATE TABLE testcases (
        id integer PRIMARY KEY,
        dataset_id integer NOT NULL REFERENCES datasets (id),
        codename varchar NOT NULL,
        public boolean NOT NULL DEFAULT true,
        input varchar NOT NULL,
        output varchar NOT NULL,
        UNIQUE (dataset_id, codename))",
    "CREATE TABLE submissions (
        id integer PRIMARY KEY,
        opaque_id bigint NOT NULL DEFAULT 0,
        participation_id integer NOT NULL REFERENCES participations (id),
        task_id integer NOT NULL REFERENCES tasks (id),
        timestamp timestamp NOT NULL DEFAULT '2026-01-01',
        language varchar,
        comment varchar NOT NULL DEFAULT '',
        official boolean NOT NULL DEFAULT true)",
    "CREATE TABLE submission_results (
        submission_id integer NOT NULL REFERENCES submissions (id),
        dataset_id integer NOT NULL REFERENCES datasets (id),
        compilation_outcome compilation_outcome,
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
        evaluation_outcome evaluation_outcome,
        evaluation_tries integer NOT NULL DEFAULT 0,
        score double precision,
        score_details jsonb,
        scored_at timestamp,
        public_score double precision,
        public_score_details jsonb,
        ranking_score_details varchar[],
        PRIMARY KEY (submission_id, dataset_id))",
    "CREATE TABLE files (
        id serial PRIMARY KEY,
        submission_id integer NOT NULL REFERENCES submissions (id),
        filename varchar NOT NULL,
        digest varchar NOT NULL)",
    "CREATE TABLE managers (
        id serial PRIMARY KEY,
        dataset_id integer NOT NULL REFERENCES datasets (id),
        filename varchar NOT NULL,
        digest varchar NOT NULL)",
    "CREATE TABLE executables (
        id serial PRIMARY KEY,
        submission_id integer NOT NULL,
        dataset_id integer NOT NULL,
        filename varchar NOT NULL,
        digest varchar NOT NULL,
        UNIQUE (submission_id, dataset_id, filename))",
    "CREATE TABLE evaluations (
        id serial PRIMARY KEY,
        submission_id integer NOT NULL,
        dataset_id integer NOT NULL,
        testcase_id integer NOT NULL REFERENCES testcases (id),
        outcome varchar,
        text varchar[] NOT NULL DEFAULT '{}',
        admin_text varchar,
        execution_time double precision,
        execution_wall_clock_time double precision,
        execution_memory bigint,
        evaluation_shard integer,
        evaluation_sandbox_paths varchar[],
        evaluation_sandbox_digests varchar[],
        UNIQUE (submission_id, dataset_id, testcase_id))",
    "CREATE TABLE user_tests (
        id integer PRIMARY KEY,
        participation_id integer NOT NULL REFERENCES participations (id),
        task_id integer NOT NULL REFERENCES tasks (id),
        timestamp timestamp NOT NULL DEFAULT '2026-01-01',
        language varchar,
        input varchar NOT NULL)",
    "CREATE TABLE user_test_files (
        id serial PRIMARY KEY,
        user_test_id integer NOT NULL REFERENCES user_tests (id),
        filename varchar NOT NULL,
        digest varchar NOT NULL)",
    "CREATE TABLE user_test_managers (
        id serial PRIMARY KEY,
        user_test_id integer NOT NULL REFERENCES user_tests (id),
        filename varchar NOT NULL,
        digest varchar NOT NULL)",
    "CREATE TABLE user_test_results (
        user_test_id integer NOT NULL REFERENCES user_tests (id),
        dataset_id integer NOT NULL REFERENCES datasets (id),
        output varchar,
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
        evaluation_text varchar[] NOT NULL DEFAULT '{}',
        evaluation_tries integer NOT NULL DEFAULT 0,
        execution_time double precision,
        execution_wall_clock_time double precision,
        execution_memory bigint,
        evaluation_shard integer,
        evaluation_sandbox_paths varchar[],
        evaluation_sandbox_digests varchar[],
        PRIMARY KEY (user_test_id, dataset_id))",
    "CREATE TABLE user_test_executables (
        id serial PRIMARY KEY,
        user_test_id integer NOT NULL,
        dataset_id integer NOT NULL,
        filename varchar NOT NULL,
        digest varchar NOT NULL,
        UNIQUE (user_test_id, dataset_id, filename))",
];

/// Recreates the schema and seeds the one submission the operation tests use.
pub async fn create(connection: &mut PgConnection, schema: &str) {
    for statement in [
        format!("DROP SCHEMA IF EXISTS {schema} CASCADE"),
        format!("CREATE SCHEMA {schema}"),
        format!("SET search_path TO {schema}"),
    ] {
        sqlx::raw_sql(AssertSqlSafe(statement))
            .execute(&mut *connection)
            .await
            .expect("creating the operation schema");
    }
    for statement in TABLES {
        sqlx::raw_sql(AssertSqlSafe(*statement))
            .execute(&mut *connection)
            .await
            .expect("creating an operation table");
    }
}
