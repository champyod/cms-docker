//! The scratch schema the status tally is counted against, and the rows the three suites seed it with.
//! Every table is `TEMP`, so each test owns its own copy in its own connection and leaves the database as it was.

use sqlx::postgres::PgConnection;
use sqlx::{AssertSqlSafe, Connection};

/// The environment variable naming the scratch database.
pub const URL_ENV: &str = "CMS_DB_TEST_URL";

/// The contest the fixtures count, and the other one a task is shared with.
pub const CONTEST: i32 = 1;
pub const OTHER_CONTEST: i32 = 2;

/// The task every fixture submission is on, and the dataset it is active on.
pub const TASK: i32 = 10;
pub const ACTIVE_DATASET: i32 = 20;

/// A dataset of the same task that is not the active one.
pub const INACTIVE_DATASET: i32 = 21;

/// The participant of [`CONTEST`], and the one of [`OTHER_CONTEST`].
pub const PARTICIPATION: i32 = 100;
pub const OTHER_PARTICIPATION: i32 = 101;

/// The tables the tally reads, plus `contest_tasks`, which records that the task is shared.
const TABLES: &[&str] = &[
    "CREATE TEMP TABLE tasks (
        id integer PRIMARY KEY,
        active_dataset_id integer)",
    "CREATE TEMP TABLE contest_tasks (
        contest_id integer NOT NULL,
        task_id integer NOT NULL,
        PRIMARY KEY (contest_id, task_id))",
    "CREATE TEMP TABLE participations (
        id integer PRIMARY KEY,
        contest_id integer NOT NULL)",
    "CREATE TEMP TABLE submissions (
        id integer PRIMARY KEY,
        task_id integer NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
        participation_id integer NOT NULL REFERENCES participations (id) ON DELETE CASCADE)",
    "CREATE TEMP TABLE submission_results (
        submission_id integer NOT NULL REFERENCES submissions (id) ON DELETE CASCADE,
        dataset_id integer NOT NULL,
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
];

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

/// A connection whose temp schema holds every table the tally reads.
pub async fn open(url: &str) -> PgConnection {
    let mut connection = PgConnection::connect(url)
        .await
        .expect("connecting to the scratch database");
    for statement in TABLES {
        exec(&mut connection, statement).await;
    }
    exec(
        &mut connection,
        &format!("INSERT INTO tasks (id, active_dataset_id) VALUES ({TASK}, {ACTIVE_DATASET})"),
    )
    .await;
    exec(
        &mut connection,
        &format!(
            "INSERT INTO contest_tasks (contest_id, task_id) VALUES ({CONTEST}, {TASK}), ({OTHER_CONTEST}, {TASK})"
        ),
    )
    .await;
    exec(
        &mut connection,
        &format!(
            "INSERT INTO participations (id, contest_id) VALUES ({PARTICIPATION}, {CONTEST}), ({OTHER_PARTICIPATION}, {OTHER_CONTEST})"
        ),
    )
    .await;
    connection
}

/// Marks `submissions` as sent on [`TASK`], each by the participation of [`CONTEST`].
pub async fn seed_submissions(connection: &mut PgConnection, submissions: &[i32]) {
    let values = submissions
        .iter()
        .map(|submission| format!("({submission}, {TASK}, {PARTICIPATION})"))
        .collect::<Vec<_>>()
        .join(", ");
    exec(
        connection,
        &format!("INSERT INTO submissions (id, task_id, participation_id) VALUES {values}"),
    )
    .await;
}

/// One `submission_results` row a test seeds: its two outcomes, their attempts, and whether it is scored.
#[derive(Debug, Clone, Copy)]
pub struct ResultSpec {
    /// The submission the result belongs to.
    pub submission: i32,
    /// The dataset that judged it.
    pub dataset: i32,
    /// `compilation_outcome`, absent until compilation ends.
    pub compilation: Option<&'static str>,
    /// `compilation_tries`.
    pub compilation_tries: i32,
    /// `evaluation_outcome`, absent until evaluation ends.
    pub evaluation: Option<&'static str>,
    /// `evaluation_tries`.
    pub evaluation_tries: i32,
    /// Whether all five score columns hold a value.
    pub scored: bool,
}

/// Seeds `results` with the five score columns filled when the spec is scored.
pub async fn seed_results(connection: &mut PgConnection, results: &[ResultSpec]) {
    let values = results
        .iter()
        .map(|result| {
            format!(
                "({}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {})",
                result.submission,
                result.dataset,
                option(result.compilation),
                result.compilation_tries,
                option(result.evaluation),
                result.evaluation_tries,
                value(result.scored, "1.0"),
                value(result.scored, "'{}'::jsonb"),
                value(result.scored, "1.0"),
                value(result.scored, "'{}'::jsonb"),
                value(result.scored, "ARRAY['1']"),
            )
        })
        .collect::<Vec<_>>()
        .join(", ");
    exec(
        connection,
        &format!(
            "INSERT INTO submission_results (submission_id, dataset_id, compilation_outcome,
                compilation_tries, evaluation_outcome, evaluation_tries, score, score_details,
                public_score, public_score_details, ranking_score_details) VALUES {values}"
        ),
    )
    .await;
}

/// An outcome column's SQL spelling, or `NULL` when nothing was recorded.
fn option(value: Option<&str>) -> String {
    value.map_or_else(|| "NULL".to_owned(), |text| format!("'{text}'"))
}

/// A score column's SQL spelling, or `NULL` when the result is not scored.
fn value(scored: bool, spelling: &str) -> &str {
    if scored {
        spelling
    } else {
        "NULL"
    }
}

/// Runs one statement the fixture writes itself.
pub async fn exec(connection: &mut PgConnection, statement: &str) {
    sqlx::raw_sql(AssertSqlSafe(statement))
        .execute(&mut *connection)
        .await
        .expect("the fixture statement");
}
