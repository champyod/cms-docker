//! The scratch schema the two util-read suites share, and the rows they seed it with.
//!
//! Every table is `TEMP`, so each test owns its own copy in its own connection and
//! leaves the scratch database exactly as it found it.

use cms_db::FileDigest;
use sqlx::postgres::PgConnection;
use sqlx::{AssertSqlSafe, Connection};

/// The environment variable naming the scratch database.
pub const URL_ENV: &str = "CMS_DB_TEST_URL";

/// The contests, tasks and participations the condition is written against.
pub const CONTEST: i32 = 1;
pub const OTHER_CONTEST: i32 = 2;
pub const TASK: i32 = 10;
pub const OTHER_TASK: i32 = 11;
pub const SHARED_TASK: i32 = 12;
pub const PARTICIPATION: i32 = 100;
pub const OTHER_PARTICIPATION: i32 = 101;

/// The `contests`, `tasks`, `contest_tasks` and `participations` columns the queries read.
const TABLES: &[&str] = &[
    "CREATE TEMP TABLE contests (
        id integer PRIMARY KEY,
        name varchar NOT NULL UNIQUE,
        description varchar NOT NULL,
        allowed_localizations varchar[] NOT NULL DEFAULT '{}',
        languages varchar[] NOT NULL DEFAULT '{}',
        submissions_download_allowed boolean NOT NULL DEFAULT true,
        allow_questions boolean NOT NULL DEFAULT true,
        allow_user_tests boolean NOT NULL DEFAULT true,
        allow_unofficial_submission_before_analysis_mode boolean NOT NULL DEFAULT false,
        block_hidden_participations boolean NOT NULL DEFAULT false,
        allow_password_authentication boolean NOT NULL DEFAULT true,
        allow_registration boolean NOT NULL DEFAULT false,
        ip_restriction boolean NOT NULL DEFAULT true,
        ip_autologin boolean NOT NULL DEFAULT false,
        token_mode varchar NOT NULL DEFAULT 'infinite',
        token_max_number integer,
        token_min_interval interval NOT NULL DEFAULT '0 seconds',
        token_gen_initial integer NOT NULL DEFAULT 2,
        token_gen_number integer NOT NULL DEFAULT 2,
        token_gen_interval interval NOT NULL DEFAULT '30 minutes',
        token_gen_max integer,
        start timestamp NOT NULL DEFAULT '2000-01-01',
        stop timestamp NOT NULL DEFAULT '2030-01-01',
        analysis_enabled boolean NOT NULL DEFAULT false,
        analysis_start timestamp NOT NULL DEFAULT '2030-01-01',
        analysis_stop timestamp NOT NULL DEFAULT '2030-01-01',
        timezone varchar,
        per_user_time interval,
        max_submission_number integer,
        max_user_test_number integer,
        min_submission_interval interval,
        min_submission_interval_grace_period interval,
        min_user_test_interval interval,
        evaluation_throttle_delay_s integer NOT NULL DEFAULT 0,
        evaluation_throttle_window_s integer NOT NULL DEFAULT 0,
        evaluation_throttle_max integer NOT NULL DEFAULT 0,
        evaluation_final_open boolean NOT NULL DEFAULT false,
        evaluation_final_open_at timestamp,
        queue_fairness_penalty_seconds integer NOT NULL DEFAULT 0,
        score_precision integer NOT NULL DEFAULT 0,
        is_active boolean NOT NULL DEFAULT false)",
    "CREATE TEMP TABLE tasks (
        id integer PRIMARY KEY,
        name varchar NOT NULL DEFAULT 'task',
        title varchar NOT NULL DEFAULT 'Task',
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
    "CREATE TEMP TABLE contest_tasks (
        contest_id integer NOT NULL REFERENCES contests (id) ON DELETE CASCADE,
        task_id integer NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
        num integer,
        PRIMARY KEY (contest_id, task_id))",
    "CREATE TEMP TABLE participations (
        id integer PRIMARY KEY,
        contest_id integer NOT NULL REFERENCES contests (id) ON DELETE CASCADE)",
    "CREATE TEMP TABLE datasets (
        id integer PRIMARY KEY,
        task_id integer NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
        description varchar NOT NULL DEFAULT 'dataset',
        autojudge boolean NOT NULL DEFAULT false,
        time_limit double precision,
        memory_limit bigint,
        task_type varchar NOT NULL DEFAULT 'Batch',
        score_type varchar NOT NULL DEFAULT 'Sum',
        score_type_parameters jsonb NOT NULL DEFAULT '0')",
    "CREATE TEMP TABLE submissions (
        id integer PRIMARY KEY,
        opaque_id bigint NOT NULL DEFAULT 0,
        task_id integer NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
        participation_id integer NOT NULL REFERENCES participations (id) ON DELETE CASCADE,
        timestamp timestamp NOT NULL DEFAULT '2026-01-01',
        language varchar,
        comment varchar NOT NULL DEFAULT '',
        official boolean NOT NULL DEFAULT true)",
    "CREATE TEMP TABLE submission_results (
        submission_id integer NOT NULL REFERENCES submissions (id) ON DELETE CASCADE,
        dataset_id integer NOT NULL REFERENCES datasets (id) ON DELETE CASCADE,
        compilation_outcome varchar,
        compilation_tries integer NOT NULL DEFAULT 0,
        evaluation_outcome varchar,
        evaluation_tries integer NOT NULL DEFAULT 0,
        score double precision,
        score_details jsonb,
        public_score double precision,
        public_score_details jsonb,
        ranking_score_details varchar[],
        PRIMARY KEY (submission_id, dataset_id))",
    "CREATE TEMP TABLE statements (
        id integer PRIMARY KEY,
        task_id integer NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
        digest varchar NOT NULL)",
    "CREATE TEMP TABLE attachments (
        id integer PRIMARY KEY,
        task_id integer NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
        digest varchar NOT NULL)",
    "CREATE TEMP TABLE managers (
        id integer PRIMARY KEY,
        dataset_id integer NOT NULL REFERENCES datasets (id) ON DELETE CASCADE,
        digest varchar NOT NULL)",
    "CREATE TEMP TABLE testcases (
        id integer PRIMARY KEY,
        dataset_id integer NOT NULL REFERENCES datasets (id) ON DELETE CASCADE,
        input varchar NOT NULL,
        output varchar NOT NULL)",
    "CREATE TEMP TABLE files (
        id integer PRIMARY KEY,
        submission_id integer NOT NULL REFERENCES submissions (id) ON DELETE CASCADE,
        digest varchar NOT NULL)",
    "CREATE TEMP TABLE executables (
        id integer PRIMARY KEY,
        submission_id integer NOT NULL,
        dataset_id integer NOT NULL,
        digest varchar NOT NULL,
        FOREIGN KEY (submission_id, dataset_id)
            REFERENCES submission_results (submission_id, dataset_id) ON DELETE CASCADE)",
    "CREATE TEMP TABLE user_tests (
        id integer PRIMARY KEY,
        task_id integer NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
        input varchar NOT NULL)",
    "CREATE TEMP TABLE user_test_files (
        id integer PRIMARY KEY,
        user_test_id integer NOT NULL REFERENCES user_tests (id) ON DELETE CASCADE,
        digest varchar NOT NULL)",
    "CREATE TEMP TABLE user_test_managers (
        id integer PRIMARY KEY,
        user_test_id integer NOT NULL REFERENCES user_tests (id) ON DELETE CASCADE,
        digest varchar NOT NULL)",
    "CREATE TEMP TABLE user_test_results (
        user_test_id integer NOT NULL REFERENCES user_tests (id) ON DELETE CASCADE,
        dataset_id integer NOT NULL REFERENCES datasets (id) ON DELETE CASCADE,
        output varchar,
        PRIMARY KEY (user_test_id, dataset_id))",
    "CREATE TEMP TABLE user_test_executables (
        id integer PRIMARY KEY,
        user_test_id integer NOT NULL,
        dataset_id integer NOT NULL,
        digest varchar NOT NULL,
        FOREIGN KEY (user_test_id, dataset_id)
            REFERENCES user_test_results (user_test_id, dataset_id) ON DELETE CASCADE)",
];

/// A digest with `value` in its last byte, so every fixture is a distinct valid one.
pub fn digest(value: u8) -> FileDigest {
    format!("{value:040x}")
        .parse()
        .expect("a forty-hex fixture")
}

/// The scratch database's URL, or `None` with the reason printed.
pub fn skip() -> Option<String> {
    let url = std::env::var(URL_ENV)
        .ok()
        .filter(|url| !url.trim().is_empty());
    if url.is_none() {
        eprintln!("SKIP: set {URL_ENV} to a scratch database to run the live half");
    }
    url
}

/// A connection whose temp schema holds every table and the four shared rows.
pub async fn open(url: &str) -> PgConnection {
    let mut connection = PgConnection::connect(url)
        .await
        .expect("connecting to the scratch database");
    for statement in TABLES {
        sqlx::raw_sql(AssertSqlSafe(*statement))
            .execute(&mut connection)
            .await
            .expect("creating the util-read schema");
    }
    seed(&mut connection).await;
    connection
}

/// Two contests, three tasks, and the two participations the searches filter by.
async fn seed(connection: &mut PgConnection) {
    let statements = [
        "INSERT INTO contests (id, name, description) VALUES
            (1, 'alpha', 'Alpha'), (2, 'beta', 'Beta')",
        "INSERT INTO tasks (id, name) VALUES (10, 'first'), (11, 'other'), (12, 'shared')",
        "INSERT INTO contest_tasks (contest_id, task_id) VALUES (1, 10), (1, 12), (2, 11)",
        "INSERT INTO participations (id, contest_id) VALUES (100, 1), (101, 2)",
    ];
    for statement in statements {
        sqlx::raw_sql(AssertSqlSafe(statement))
            .execute(&mut *connection)
            .await
            .expect("seeding the util-read schema");
    }
}

/// [`TASK`]'s active dataset, an autojudge one, one neither, and one of another task.
pub async fn seed_datasets(connection: &mut PgConnection) {
    let statements = [
        "INSERT INTO datasets (id, task_id, description, autojudge) VALUES
            (20, 10, 'active', false),
            (21, 10, 'autojudge', true),
            (22, 10, 'neither', false),
            (23, 12, 'other task', false)",
        "UPDATE tasks SET active_dataset_id = 20 WHERE id = 10",
        "UPDATE tasks SET active_dataset_id = 23 WHERE id = 12",
    ];
    for statement in statements {
        sqlx::raw_sql(AssertSqlSafe(statement))
            .execute(&mut *connection)
            .await
            .expect("seeding the datasets");
    }
}
