//! The schema and the rows a judging test needs, created once per test binary.
//!
//! The DDL is a fixture, not the migration: it names the columns the queries in
//! `task` and `submission` read, and keeps the foreign keys the reference declares
//! because the dataset rules are carried by them, not by code.
//!
//! `submissions.participation_id` carries no key here: `participations` belongs to
//! the identity lane and nothing in these tests reads through it.

use chrono::NaiveDateTime;
use sqlx::postgres::PgConnection;
use sqlx::Connection;

/// Every statement the fixture needs, in an order whose references already exist.
const SCHEMA: &[&str] = &[
    "CREATE TABLE IF NOT EXISTS tasks (
        id serial PRIMARY KEY,
        name varchar NOT NULL UNIQUE,
        title varchar NOT NULL,
        submission_format varchar[] NOT NULL DEFAULT '{}',
        primary_statements varchar[] NOT NULL DEFAULT '{}',
        allowed_languages varchar[],
        token_mode varchar NOT NULL DEFAULT 'disabled',
        token_max_number integer,
        token_min_interval interval NOT NULL DEFAULT '0 seconds',
        token_gen_initial integer NOT NULL DEFAULT 2,
        token_gen_number integer NOT NULL DEFAULT 2,
        token_gen_interval interval NOT NULL DEFAULT '30 minutes',
        token_gen_max integer,
        max_submission_number integer,
        max_user_test_number integer,
        min_submission_interval interval,
        min_user_test_interval interval,
        evaluation_throttle_delay_s integer,
        feedback_level varchar NOT NULL DEFAULT 'restricted',
        score_precision integer NOT NULL DEFAULT 0,
        score_mode varchar NOT NULL DEFAULT 'max_tokened_last',
        active_dataset_id integer)",
    "CREATE TABLE IF NOT EXISTS datasets (
        id serial PRIMARY KEY,
        task_id integer NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
        description varchar NOT NULL,
        autojudge boolean NOT NULL DEFAULT false,
        time_limit double precision,
        memory_limit bigint,
        task_type varchar NOT NULL,
        task_type_parameters jsonb NOT NULL DEFAULT '{}',
        score_type varchar NOT NULL,
        score_type_parameters jsonb NOT NULL DEFAULT '{}',
        UNIQUE (task_id, description),
        UNIQUE (id, task_id))",
    // The pointer is a composite key onto (task_id, id), which is what makes a
    // dataset of another task impossible rather than merely rejected in code.
    "DO $$ BEGIN
        ALTER TABLE tasks ADD CONSTRAINT fk_active_dataset
            FOREIGN KEY (id, active_dataset_id) REFERENCES datasets (task_id, id)
            ON UPDATE SET NULL ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$",
    "CREATE TABLE IF NOT EXISTS testcases (
        id serial PRIMARY KEY,
        dataset_id integer NOT NULL REFERENCES datasets (id) ON DELETE CASCADE,
        codename varchar NOT NULL,
        public boolean NOT NULL DEFAULT false,
        input varchar NOT NULL,
        output varchar NOT NULL,
        UNIQUE (dataset_id, codename))",
    "CREATE TABLE IF NOT EXISTS submissions (
        id serial PRIMARY KEY,
        opaque_id bigint NOT NULL,
        participation_id integer NOT NULL,
        task_id integer NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
        timestamp timestamp NOT NULL,
        language varchar,
        comment varchar NOT NULL DEFAULT '',
        official boolean NOT NULL DEFAULT true,
        UNIQUE (participation_id, opaque_id))",
    "CREATE TABLE IF NOT EXISTS submission_results (
        submission_id integer NOT NULL REFERENCES submissions (id) ON DELETE CASCADE,
        dataset_id integer NOT NULL REFERENCES datasets (id) ON DELETE CASCADE,
        compilation_outcome varchar,
        compilation_text varchar[] NOT NULL DEFAULT '{}',
        compilation_tries integer NOT NULL DEFAULT 0,
        compilation_time double precision,
        evaluation_outcome varchar,
        evaluation_tries integer NOT NULL DEFAULT 0,
        score double precision,
        score_details jsonb,
        public_score double precision,
        public_score_details jsonb,
        ranking_score_details varchar[],
        PRIMARY KEY (submission_id, dataset_id))",
    "CREATE TABLE IF NOT EXISTS executables (
        id serial PRIMARY KEY,
        submission_id integer NOT NULL,
        dataset_id integer NOT NULL,
        filename varchar NOT NULL,
        digest varchar NOT NULL,
        FOREIGN KEY (submission_id, dataset_id)
            REFERENCES submission_results (submission_id, dataset_id) ON DELETE CASCADE,
        UNIQUE (submission_id, dataset_id, filename))",
    "CREATE TABLE IF NOT EXISTS evaluations (
        id serial PRIMARY KEY,
        submission_id integer NOT NULL,
        dataset_id integer NOT NULL,
        testcase_id integer NOT NULL REFERENCES testcases (id) ON DELETE CASCADE,
        outcome varchar,
        text varchar[] NOT NULL DEFAULT '{}',
        admin_text varchar,
        execution_time double precision,
        execution_wall_clock_time double precision,
        execution_memory bigint,
        evaluation_shard integer,
        evaluation_sandbox_paths varchar[],
        evaluation_sandbox_digests varchar[],
        FOREIGN KEY (submission_id, dataset_id)
            REFERENCES submission_results (submission_id, dataset_id) ON DELETE CASCADE,
        UNIQUE (submission_id, dataset_id, testcase_id))",
    "CREATE TABLE IF NOT EXISTS tokens (
        id serial PRIMARY KEY,
        submission_id integer NOT NULL UNIQUE REFERENCES submissions (id) ON DELETE CASCADE,
        timestamp timestamp NOT NULL DEFAULT now())",
];

/// A `testcases.input` digest the `DIGEST` rule accepts.
const INPUT_DIGEST: &str = "0123456789abcdef0123456789abcdef01234567";

/// A `testcases.output` digest the `DIGEST` rule accepts.
const OUTPUT_DIGEST: &str = "fedcba9876543210fedcba9876543210fedcba98";

/// Create the schema, letting a concurrent test having created it already pass.
pub async fn create(connection: &mut PgConnection) {
    for statement in SCHEMA {
        // The DDL is a constant of this file, and the driver still wants that
        // stated: a statement it did not see at compile time is interpolated data.
        let sql = sqlx::AssertSqlSafe(*statement);
        if let Err(error) = sqlx::raw_sql(sql).execute(&mut *connection).await {
            if !already_there(&error) {
                panic!("creating the judging schema: {error}");
            }
        }
    }
}

/// Whether the driver refused a statement only because the object exists.
///
/// Two tests run in parallel inside one binary, so both may reach `CREATE` first.
fn already_there(error: &sqlx::Error) -> bool {
    matches!(
        error.as_database_error().and_then(|failed| failed.code()),
        Some(code)
            if code == "42P07" || code == "42710" || code == "42P16" || code == "23505"
    )
}

/// The token columns a task row is created with.
#[derive(Debug, Clone, Copy)]
pub struct Quota {
    /// `tasks.token_mode`.
    pub mode: &'static str,
    /// `tasks.token_gen_initial`.
    pub gen_initial: i32,
    /// `tasks.token_max_number`.
    pub max_number: Option<i32>,
}

/// A task of this binary's own, removed first so a rerun starts clean.
pub async fn create_task(connection: &mut PgConnection, name: &str, quota: Quota) -> i32 {
    sqlx::query("DELETE FROM tasks WHERE name = $1")
        .bind(name)
        .execute(&mut *connection)
        .await
        .expect("clearing an earlier run");
    sqlx::query_scalar(
        "INSERT INTO tasks
             (name, title, token_mode, token_gen_initial, token_gen_number,
              token_gen_interval, token_max_number)
         VALUES ($1, $1, $2, $3, 0, '30 minutes', $4)
         RETURNING id",
    )
    .bind(name)
    .bind(quota.mode)
    .bind(quota.gen_initial)
    .bind(quota.max_number)
    .fetch_one(&mut *connection)
    .await
    .expect("inserting the task")
}

/// One dataset of `task_id`, with the task type and score type the columns require.
pub async fn create_dataset(connection: &mut PgConnection, task_id: i32, description: &str) -> i32 {
    sqlx::query_scalar(
        "INSERT INTO datasets (task_id, description, task_type, score_type)
         VALUES ($1, $2, 'Batch', 'Sum')
         RETURNING id",
    )
    .bind(task_id)
    .bind(description)
    .fetch_one(&mut *connection)
    .await
    .expect("inserting the dataset")
}

/// One testcase of `dataset_id`, carrying the two digests the domain accepts.
pub async fn create_testcase(
    connection: &mut PgConnection,
    dataset_id: i32,
    codename: &str,
) -> i32 {
    sqlx::query_scalar(
        "INSERT INTO testcases (dataset_id, codename, input, output)
         VALUES ($1, $2, $3, $4)
         RETURNING id",
    )
    .bind(dataset_id)
    .bind(codename)
    .bind(INPUT_DIGEST)
    .bind(OUTPUT_DIGEST)
    .fetch_one(&mut *connection)
    .await
    .expect("inserting the testcase")
}

/// One submission of `task_id`, sent by `participation_id` at `at`.
pub async fn create_submission(
    connection: &mut PgConnection,
    task_id: i32,
    participation_id: i32,
    opaque_id: i64,
    at: NaiveDateTime,
) -> i32 {
    sqlx::query_scalar(
        "INSERT INTO submissions (opaque_id, participation_id, task_id, timestamp)
         VALUES ($1, $2, $3, $4)
         RETURNING id",
    )
    .bind(opaque_id)
    .bind(participation_id)
    .bind(task_id)
    .bind(at)
    .fetch_one(&mut *connection)
    .await
    .expect("inserting the submission")
}

/// The result row a judging pass would have written for one pair.
pub async fn create_result(connection: &mut PgConnection, submission_id: i32, dataset_id: i32) {
    sqlx::query(
        "INSERT INTO submission_results (submission_id, dataset_id, compilation_outcome)
         VALUES ($1, $2, 'ok')
         ON CONFLICT (submission_id, dataset_id) DO UPDATE
             SET compilation_outcome = 'ok'",
    )
    .bind(submission_id)
    .bind(dataset_id)
    .execute(&mut *connection)
    .await
    .expect("inserting the result");
}

/// One executable, which a compilation invalidation must remove.
pub async fn create_executable(connection: &mut PgConnection, submission_id: i32, dataset_id: i32) {
    sqlx::query(
        "INSERT INTO executables (submission_id, dataset_id, filename, digest)
         VALUES ($1, $2, 'executable', $3)
         ON CONFLICT DO NOTHING",
    )
    .bind(submission_id)
    .bind(dataset_id)
    .bind(INPUT_DIGEST)
    .execute(&mut *connection)
    .await
    .expect("inserting the executable");
}

/// One evaluation row on `testcase_id`.
pub async fn create_evaluation(
    connection: &mut PgConnection,
    submission_id: i32,
    dataset_id: i32,
    testcase_id: i32,
) {
    sqlx::query(
        "INSERT INTO evaluations (submission_id, dataset_id, testcase_id, outcome, execution_time)
         VALUES ($1, $2, $3, '1.0', 1.5)
         ON CONFLICT DO NOTHING",
    )
    .bind(submission_id)
    .bind(dataset_id)
    .bind(testcase_id)
    .execute(&mut *connection)
    .await
    .expect("inserting the evaluation");
}

/// A scratch database, and the schema in it, or `None` when the URL is unset.
pub async fn open(url: &str) -> Result<PgConnection, sqlx::Error> {
    let mut connection = PgConnection::connect(url).await?;
    create(&mut connection).await;
    Ok(connection)
}
