//! The three submissions and four results the two search suites filter over.

use sqlx::postgres::PgConnection;
use sqlx::AssertSqlSafe;

/// The three submissions the fixture sends.
pub const FIRST_SUBMISSION: i32 = 1000;
pub const SECOND_SUBMISSION: i32 = 1001;
pub const THIRD_SUBMISSION: i32 = 1002;

/// The four datasets and the result each one holds.
pub const FIRST_DATASET: i32 = 20;
pub const SECOND_DATASET: i32 = 23;
pub const THIRD_DATASET: i32 = 21;
pub const FOURTH_DATASET: i32 = 22;

/// Three submissions, four results, each on its own task's dataset.
pub async fn seed(connection: &mut PgConnection) {
    let statements = [
        "INSERT INTO datasets (id, task_id, description) VALUES
            (20, 10, 'first'), (23, 10, 'second'), (21, 12, 'shared'), (22, 11, 'other')",
        "INSERT INTO submissions (id, opaque_id, task_id, participation_id, comment) VALUES
            (1000, 1, 10, 100, ''), (1001, 2, 12, 100, ''), (1002, 3, 11, 101, 'first line')",
        "INSERT INTO submission_results
            (submission_id, dataset_id, compilation_outcome, evaluation_outcome, score, public_score)
         VALUES (1000, 20, 'ok', 'ok', 5.0, 3.0),
                (1000, 23, 'ok', NULL, NULL, NULL),
                (1001, 21, 'ok', 'ok', 7.0, 7.0),
                (1002, 22, 'fail', NULL, NULL, NULL)",
    ];
    for statement in statements {
        sqlx::raw_sql(AssertSqlSafe(statement))
            .execute(&mut *connection)
            .await
            .expect("seeding the search fixture");
    }
}
