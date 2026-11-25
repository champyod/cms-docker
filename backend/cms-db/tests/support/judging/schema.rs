//! The schema a judging test needs, created once per test binary.
//!
//! The DDL names the columns the queries in `task` and `submission` read, and keeps
//! the foreign keys the reference declares: the dataset rules are carried by them,
//! not by code. The fixture owns this schema, so a table of an older shape has to be
//! dropped rather than migrated.

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
    "DROP TABLE IF EXISTS executables",
    "DROP TABLE IF EXISTS evaluations",
    "DROP TABLE IF EXISTS submission_results CASCADE",
    "CREATE TABLE IF NOT EXISTS submission_results (
        submission_id integer NOT NULL REFERENCES submissions (id) ON DELETE CASCADE,
        dataset_id integer NOT NULL REFERENCES datasets (id) ON DELETE CASCADE,
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

/// A scratch database, and the schema in it, or `None` when the URL is unset.
pub async fn open(url: &str) -> Result<PgConnection, sqlx::Error> {
    let mut connection = PgConnection::connect(url).await?;
    create(&mut connection).await;
    Ok(connection)
}
