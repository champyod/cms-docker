//! The contest-scoped candidate reads the EvaluationService sweeps.
//!
//! Each read returns the work one object still owes for one judgeable dataset.
//! The retry ceiling is a parameter so the service and the query cannot disagree
//! about when to stop retrying.

use chrono::NaiveDateTime;
use sqlx::postgres::PgConnection;

use crate::reads::DatasetId;

/// One submission or user test that still needs compiling for a dataset.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompilationCandidate {
    /// `submissions.id` or `user_tests.id`.
    pub object_id: i32,
    /// The dataset the object is judged on.
    pub dataset_id: DatasetId,
    /// The submission or user-test timestamp.
    pub timestamp: NaiveDateTime,
    /// Whether the dataset is its task's active one.
    pub is_active: bool,
    /// Compilation attempts so far, zero when no result row exists.
    pub tries: i32,
}

/// One testcase a compiled submission still needs evaluated.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EvaluationCandidate {
    /// `submissions.id`.
    pub object_id: i32,
    /// The dataset holding the testcase.
    pub dataset_id: DatasetId,
    /// The submission timestamp.
    pub timestamp: NaiveDateTime,
    /// Whether the dataset is its task's active one.
    pub is_active: bool,
    /// Evaluation attempts so far.
    pub tries: i32,
    /// `testcases.codename`, the testcase without an evaluation row; absent for a
    /// user test, which evaluates the whole dataset at once.
    pub testcase_codename: Option<String>,
}

/// Submissions with no result, or an unfinished compilation below the ceiling.
const SUBMISSION_COMPILATIONS: &str = "\
    SELECT s.id AS object_id, d.id AS dataset_id, s.timestamp,
           d.id = t.active_dataset_id AS is_active,
           COALESCE(r.compilation_tries, 0) AS tries
    FROM submissions AS s
    JOIN tasks AS t ON t.id = s.task_id
    JOIN datasets AS d ON d.task_id = t.id
    JOIN participations AS p ON p.id = s.participation_id
    LEFT JOIN submission_results AS r
           ON r.submission_id = s.id AND r.dataset_id = d.id
    WHERE (d.id = t.active_dataset_id OR d.autojudge)
      AND (r.submission_id IS NULL
           OR (r.compilation_outcome IS NULL AND r.compilation_tries < $2))
      AND ($1::integer IS NULL OR p.contest_id = $1)
    ORDER BY s.timestamp, s.id, d.id";

/// Compiled, unevaluated submissions with a testcase that has no evaluation row.
const SUBMISSION_EVALUATIONS: &str = "\
    SELECT s.id AS object_id, d.id AS dataset_id, s.timestamp,
           d.id = t.active_dataset_id AS is_active,
           r.evaluation_tries AS tries, tc.codename AS testcase_codename
    FROM submissions AS s
    JOIN tasks AS t ON t.id = s.task_id
    JOIN datasets AS d ON d.task_id = t.id
    JOIN participations AS p ON p.id = s.participation_id
    JOIN submission_results AS r
      ON r.submission_id = s.id AND r.dataset_id = d.id
    JOIN testcases AS tc ON tc.dataset_id = d.id
    LEFT JOIN evaluations AS e
           ON e.submission_id = s.id AND e.dataset_id = d.id
          AND e.testcase_id = tc.id
    WHERE (d.id = t.active_dataset_id OR d.autojudge)
      AND r.compilation_outcome = 'ok'
      AND r.evaluation_outcome IS NULL
      AND r.evaluation_tries < $2
      AND e.id IS NULL
      AND ($1::integer IS NULL OR p.contest_id = $1)
    ORDER BY s.timestamp, s.id, d.id, tc.codename";

/// User tests with no result, or an unfinished compilation below the ceiling.
const USER_TEST_COMPILATIONS: &str = "\
    SELECT ut.id AS object_id, d.id AS dataset_id, ut.timestamp,
           d.id = t.active_dataset_id AS is_active,
           COALESCE(r.compilation_tries, 0) AS tries
    FROM user_tests AS ut
    JOIN tasks AS t ON t.id = ut.task_id
    JOIN datasets AS d ON d.task_id = t.id
    JOIN participations AS p ON p.id = ut.participation_id
    LEFT JOIN user_test_results AS r
           ON r.user_test_id = ut.id AND r.dataset_id = d.id
    WHERE (d.id = t.active_dataset_id OR d.autojudge)
      AND (r.user_test_id IS NULL
           OR (r.compilation_outcome IS NULL AND r.compilation_tries < $2))
      AND ($1::integer IS NULL OR p.contest_id = $1)
    ORDER BY ut.timestamp, ut.id, d.id";

/// Compiled, unevaluated user tests on a judgeable dataset.
const USER_TEST_EVALUATIONS: &str = "\
    SELECT ut.id AS object_id, d.id AS dataset_id, ut.timestamp,
           d.id = t.active_dataset_id AS is_active,
           r.evaluation_tries AS tries, NULL::varchar AS testcase_codename
    FROM user_tests AS ut
    JOIN tasks AS t ON t.id = ut.task_id
    JOIN datasets AS d ON d.task_id = t.id
    JOIN participations AS p ON p.id = ut.participation_id
    JOIN user_test_results AS r
      ON r.user_test_id = ut.id AND r.dataset_id = d.id
    WHERE (d.id = t.active_dataset_id OR d.autojudge)
      AND r.compilation_outcome = 'ok'
      AND r.evaluation_outcome IS NULL
      AND r.evaluation_tries < $2
      AND ($1::integer IS NULL OR p.contest_id = $1)
    ORDER BY ut.timestamp, ut.id, d.id";

/// Submissions that still need compiling, optionally limited to one contest.
///
/// # Errors
///
/// Returns the driver's own error for a statement it could not run.
pub async fn submission_compilations(
    connection: &mut PgConnection,
    contest_id: Option<i32>,
    max_tries: i32,
) -> Result<Vec<CompilationCandidate>, sqlx::Error> {
    let rows = sqlx::query_as::<_, CompilationRow>(SUBMISSION_COMPILATIONS)
        .bind(contest_id)
        .bind(max_tries)
        .fetch_all(connection)
        .await?;
    Ok(rows.into_iter().map(CompilationCandidate::from).collect())
}

/// Submission testcases that still need evaluating, optionally limited to one contest.
///
/// # Errors
///
/// Returns the driver's own error for a statement it could not run.
pub async fn submission_evaluations(
    connection: &mut PgConnection,
    contest_id: Option<i32>,
    max_tries: i32,
) -> Result<Vec<EvaluationCandidate>, sqlx::Error> {
    let rows = sqlx::query_as::<_, EvaluationRow>(SUBMISSION_EVALUATIONS)
        .bind(contest_id)
        .bind(max_tries)
        .fetch_all(connection)
        .await?;
    Ok(rows.into_iter().map(EvaluationCandidate::from).collect())
}

/// User tests that still need compiling, optionally limited to one contest.
///
/// # Errors
///
/// Returns the driver's own error for a statement it could not run.
pub async fn user_test_compilations(
    connection: &mut PgConnection,
    contest_id: Option<i32>,
    max_tries: i32,
) -> Result<Vec<CompilationCandidate>, sqlx::Error> {
    let rows = sqlx::query_as::<_, CompilationRow>(USER_TEST_COMPILATIONS)
        .bind(contest_id)
        .bind(max_tries)
        .fetch_all(connection)
        .await?;
    Ok(rows.into_iter().map(CompilationCandidate::from).collect())
}

/// Compiled user tests that still need evaluating, optionally limited to one contest.
///
/// # Errors
///
/// Returns the driver's own error for a statement it could not run.
pub async fn user_test_evaluations(
    connection: &mut PgConnection,
    contest_id: Option<i32>,
    max_tries: i32,
) -> Result<Vec<EvaluationCandidate>, sqlx::Error> {
    let rows = sqlx::query_as::<_, EvaluationRow>(USER_TEST_EVALUATIONS)
        .bind(contest_id)
        .bind(max_tries)
        .fetch_all(connection)
        .await?;
    Ok(rows.into_iter().map(EvaluationCandidate::from).collect())
}

#[derive(Debug, sqlx::FromRow)]
struct CompilationRow {
    object_id: i32,
    dataset_id: i32,
    timestamp: NaiveDateTime,
    is_active: bool,
    tries: i32,
}

impl From<CompilationRow> for CompilationCandidate {
    fn from(row: CompilationRow) -> Self {
        Self {
            object_id: row.object_id,
            dataset_id: DatasetId(row.dataset_id),
            timestamp: row.timestamp,
            is_active: row.is_active,
            tries: row.tries,
        }
    }
}

#[derive(Debug, sqlx::FromRow)]
struct EvaluationRow {
    object_id: i32,
    dataset_id: i32,
    timestamp: NaiveDateTime,
    is_active: bool,
    tries: i32,
    testcase_codename: Option<String>,
}

impl From<EvaluationRow> for EvaluationCandidate {
    fn from(row: EvaluationRow) -> Self {
        Self {
            object_id: row.object_id,
            dataset_id: DatasetId(row.dataset_id),
            timestamp: row.timestamp,
            is_active: row.is_active,
            tries: row.tries,
            testcase_codename: row.testcase_codename,
        }
    }
}
