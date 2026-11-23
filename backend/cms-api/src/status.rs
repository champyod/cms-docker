//! How many submissions sit in each status: `server.py:112-201`, counted over each task's active dataset.
//!
//! `submissions` drives the scan, so the total is every submission in scope and one whose active dataset has
//! no result arrives with nothing attached — the case [`StatusCounts`]'s reconciliation exists for. A contest
//! restricts the scan through the submission's participation, never through its task.

use cms_db::{CompilationOutcome, DatasetId, EvaluationOutcome, SubmissionId, SubmissionResult};
use sqlx::postgres::{PgConnection, Postgres};
use sqlx::{FromRow, QueryBuilder};

mod counts;

pub use counts::StatusCounts;

use counts::count;

/// One submission per row, with its active-dataset result left-joined when that dataset has judged it.
const STATUS_ROWS: &str = "\
    SELECT s.id AS submission_id, r.dataset_id AS dataset_id,
           r.compilation_outcome, r.compilation_tries,
           r.evaluation_outcome, r.evaluation_tries,
           r.score, r.score_details::text AS score_details,
           r.public_score, r.public_score_details::text AS public_score_details,
           r.ranking_score_details
    FROM submissions AS s
    JOIN tasks AS t ON t.id = s.task_id
    LEFT JOIN submission_results AS r
           ON r.submission_id = s.id AND r.dataset_id = t.active_dataset_id";

/// The seven statuses and the total, for `contest_id`'s submissions or for all of them when `None`.
///
/// The reference's docstring says six statuses; what it returns is these seven plus `total`, and the gauge
/// reads the dict.
///
/// # Errors
///
/// Returns the driver's own error for a statement it refused, and a `ColumnDecode` naming the column when an
/// outcome holds a value the enum does not declare or a joined counter arrives NULL.
pub async fn submissions_status(
    connection: &mut PgConnection,
    contest_id: Option<i32>,
) -> Result<StatusCounts, sqlx::Error> {
    let mut query = QueryBuilder::<Postgres>::new(STATUS_ROWS);
    if let Some(contest_id) = contest_id {
        query.push(" JOIN participations AS p ON p.id = s.participation_id WHERE p.contest_id = ");
        query.push_bind(contest_id);
    }
    let rows = query
        .build_query_as::<StatusRow>()
        .fetch_all(&mut *connection)
        .await?;
    let results = rows
        .into_iter()
        .map(status_row_result)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(count(&results))
}

/// One `submissions` row and its active-dataset result, before the two outcome columns are typed.
#[derive(Debug, FromRow)]
struct StatusRow {
    submission_id: i32,
    dataset_id: Option<i32>,
    compilation_outcome: Option<String>,
    compilation_tries: Option<i32>,
    evaluation_outcome: Option<String>,
    evaluation_tries: Option<i32>,
    score: Option<f64>,
    score_details: Option<String>,
    public_score: Option<f64>,
    public_score_details: Option<String>,
    ranking_score_details: Option<Vec<String>>,
}

/// The result this row carries, or `None` when its active dataset has never judged it.
fn status_row_result(row: StatusRow) -> Result<Option<SubmissionResult>, sqlx::Error> {
    let Some(dataset_id) = row.dataset_id else {
        return Ok(None);
    };
    Ok(Some(SubmissionResult {
        submission_id: SubmissionId(row.submission_id),
        dataset_id: DatasetId(dataset_id),
        compilation_outcome: outcome(
            "compilation_outcome",
            row.compilation_outcome,
            CompilationOutcome::parse,
        )?,
        compilation_tries: required("compilation_tries", row.compilation_tries)?,
        evaluation_outcome: outcome(
            "evaluation_outcome",
            row.evaluation_outcome,
            EvaluationOutcome::parse,
        )?,
        evaluation_tries: required("evaluation_tries", row.evaluation_tries)?,
        score: row.score,
        score_details: row.score_details,
        public_score: row.public_score,
        public_score_details: row.public_score_details,
        ranking_score_details: row.ranking_score_details,
    }))
}

/// One enum column typed, naming it when it holds a value the enum does not declare.
fn outcome<T>(
    column: &'static str,
    value: Option<String>,
    parse: impl Fn(&str) -> Option<T>,
) -> Result<Option<T>, sqlx::Error> {
    value
        .map(|text| {
            parse(&text).ok_or_else(|| sqlx::Error::ColumnDecode {
                index: column.to_owned(),
                source: format!("{text:?} is not a value of {column}").into(),
            })
        })
        .transpose()
}

/// One counter a joined result row must hold: `NOT NULL` in the schema, so a NULL means no result was joined.
fn required(column: &'static str, value: Option<i32>) -> Result<i32, sqlx::Error> {
    value.ok_or_else(|| sqlx::Error::ColumnDecode {
        index: column.to_owned(),
        source: format!("{column} is NULL on a result row").into(),
    })
}
