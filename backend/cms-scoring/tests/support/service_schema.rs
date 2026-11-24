//! The private schema and base rows a scoring service test owns.

use sqlx::postgres::PgConnection;
use sqlx::AssertSqlSafe;

pub const TASK_ID: i32 = 7;
pub const DATASET_ID: i32 = 9;
pub const PARTICIPATION_ID: i32 = 100;

const TABLES: &[&str] = &[
    "CREATE TABLE contests (id integer PRIMARY KEY)",
    "CREATE TABLE participations (
        id integer PRIMARY KEY,
        contest_id integer NOT NULL REFERENCES contests (id))",
    "CREATE TABLE contest_tasks (
        contest_id integer NOT NULL REFERENCES contests (id),
        task_id integer NOT NULL,
        PRIMARY KEY (contest_id, task_id))",
    "CREATE TABLE tasks (
        id integer PRIMARY KEY,
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
        score_precision integer NOT NULL DEFAULT 2,
        score_mode varchar NOT NULL DEFAULT 'max_tokened_last',
        active_dataset_id integer)",
    "CREATE TABLE datasets (
        id integer PRIMARY KEY,
        task_id integer NOT NULL REFERENCES tasks (id),
        description varchar NOT NULL,
        autojudge boolean NOT NULL DEFAULT false,
        time_limit double precision,
        memory_limit bigint,
        task_type varchar NOT NULL,
        task_type_parameters jsonb NOT NULL DEFAULT '{}',
        score_type varchar NOT NULL,
        score_type_parameters jsonb NOT NULL DEFAULT '1')",
    "CREATE TABLE testcases (
        id integer PRIMARY KEY,
        dataset_id integer NOT NULL REFERENCES datasets (id),
        codename varchar NOT NULL,
        public boolean NOT NULL DEFAULT false,
        input varchar NOT NULL,
        output varchar NOT NULL,
        UNIQUE (dataset_id, codename))",
    "CREATE TABLE submissions (
        id integer PRIMARY KEY,
        opaque_id bigint NOT NULL,
        participation_id integer NOT NULL REFERENCES participations (id),
        task_id integer NOT NULL REFERENCES tasks (id),
        timestamp timestamp NOT NULL,
        language varchar,
        comment varchar NOT NULL DEFAULT '',
        official boolean NOT NULL DEFAULT true,
        UNIQUE (participation_id, opaque_id))",
    "CREATE TABLE submission_results (
        submission_id integer NOT NULL REFERENCES submissions (id),
        dataset_id integer NOT NULL REFERENCES datasets (id),
        compilation_outcome varchar,
        compilation_tries integer NOT NULL DEFAULT 0,
        evaluation_outcome varchar,
        evaluation_tries integer NOT NULL DEFAULT 0,
        score double precision,
        score_details jsonb,
        scored_at timestamp,
        public_score double precision,
        public_score_details jsonb,
        ranking_score_details varchar[],
        PRIMARY KEY (submission_id, dataset_id))",
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
];

/// Replace one named schema with the tables and rows every service test needs.
pub async fn create(connection: &mut PgConnection, schema: &'static str) {
    // Schema names are static test identifiers, never request data.
    sqlx::query(AssertSqlSafe(format!(
        "DROP SCHEMA IF EXISTS {schema} CASCADE"
    )))
    .execute(&mut *connection)
    .await
    .expect("clearing the test schema");
    sqlx::query(AssertSqlSafe(format!("CREATE SCHEMA {schema}")))
        .execute(&mut *connection)
        .await
        .expect("creating the test schema");
    sqlx::query(AssertSqlSafe(format!("SET search_path TO {schema}")))
        .execute(&mut *connection)
        .await
        .expect("selecting the test schema");
    for statement in TABLES {
        sqlx::raw_sql(AssertSqlSafe(*statement))
            .execute(&mut *connection)
            .await
            .expect("creating a scoring test table");
    }
    seed_base(connection).await;
}

async fn seed_base(connection: &mut PgConnection) {
    sqlx::raw_sql(AssertSqlSafe(
        "INSERT INTO contests (id) VALUES (1);
         INSERT INTO participations (id, contest_id) VALUES (100, 1);
         INSERT INTO contest_tasks (contest_id, task_id) VALUES (1, 7);
         INSERT INTO tasks (id, name, title, active_dataset_id)
             VALUES (7, 'scoring', 'Scoring', 9);
         INSERT INTO datasets
             (id, task_id, description, task_type, score_type, score_type_parameters, time_limit)
             VALUES (9, 7, 'active', 'Batch', 'Sum', '1', 2.0);
         INSERT INTO testcases (id, dataset_id, codename, public, input, output) VALUES
             (30, 9, 'alpha', true,
              '0000000000000000000000000000000000000030',
              '0000000000000000000000000000000000000040'),
             (31, 9, 'beta', false,
              '0000000000000000000000000000000000000031',
              '0000000000000000000000000000000000000041')",
    ))
    .execute(&mut *connection)
    .await
    .expect("seeding the scoring base rows");
}
