//! The rows a judging test inserts, and the quota a task is created with.
//!
//! `submissions.participation_id` carries no key here: `participations` belongs to
//! the identity lane and nothing in these tests reads through it.

use chrono::NaiveDateTime;
use sqlx::postgres::PgConnection;

/// A `testcases.input` digest the `DIGEST` rule accepts.
const INPUT_DIGEST: &str = "0123456789abcdef0123456789abcdef01234567";

/// A `testcases.output` digest the `DIGEST` rule accepts.
const OUTPUT_DIGEST: &str = "fedcba9876543210fedcba9876543210fedcba98";

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
