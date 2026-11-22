//! The `submission_results` row: `submission.py:278-639`, keyed by the submission and the dataset it judged.

use sqlx::postgres::PgConnection;

use crate::reads::{DatasetId, SubmissionId};
use crate::writes::{CompilationOutcome, EvaluationOutcome};

/// The `submission_results` columns the state machine reads, writes and clears.
#[derive(Debug, Clone, PartialEq)]
pub struct SubmissionResult {
    /// `submission_results.submission_id`, half the row's key.
    pub submission_id: SubmissionId,
    /// `submission_results.dataset_id`, the other half.
    pub dataset_id: DatasetId,
    /// `compilation_outcome`, absent until compilation ends.
    pub compilation_outcome: Option<CompilationOutcome>,
    /// `compilation_tries`, the failures so far, which every invalidation resets.
    pub compilation_tries: i32,
    /// `evaluation_outcome`, absent until every testcase of the dataset has a row.
    pub evaluation_outcome: Option<EvaluationOutcome>,
    /// `evaluation_tries`, the failures so far, which every invalidation resets.
    pub evaluation_tries: i32,
    /// `score`, absent until a scoring pass writes it.
    pub score: Option<f64>,
    /// `score_details`, the `jsonb` document behind the score, carried as its text.
    pub score_details: Option<String>,
    /// `public_score`, what a contestant is shown.
    pub public_score: Option<f64>,
    /// `public_score_details`, the `jsonb` document behind the public score.
    pub public_score_details: Option<String>,
    /// `ranking_score_details`, the one row the ranking table shows.
    pub ranking_score_details: Option<Vec<String>>,
}

/// The columns one `submission_results` row is read with: the two `jsonb` documents are cast to the text the score type wrote.
pub const RESULT_BY_ID: &str = "\
    SELECT submission_id, dataset_id, compilation_outcome, compilation_tries,
           evaluation_outcome, evaluation_tries, score, score_details::text AS score_details,
           public_score, public_score_details::text AS public_score_details,
           ranking_score_details
    FROM submission_results
    WHERE submission_id = $1 AND dataset_id = $2";

/// One result by its key, or `None` when the pair has never been judged.
///
/// # Errors
///
/// Returns the driver's own error for a row it could not read.
pub async fn result_by_id(
    connection: &mut PgConnection,
    submission: SubmissionId,
    dataset: DatasetId,
) -> Result<Option<SubmissionResult>, sqlx::Error> {
    let row = sqlx::query_as::<_, ResultRow>(RESULT_BY_ID)
        .bind(submission.0)
        .bind(dataset.0)
        .fetch_optional(connection)
        .await?;
    row.map(SubmissionResult::try_from).transpose()
}

/// The driver-facing shape of a result row, before its two outcome columns are typed.
#[derive(Debug, sqlx::FromRow)]
struct ResultRow {
    submission_id: i32,
    dataset_id: i32,
    compilation_outcome: Option<String>,
    compilation_tries: i32,
    evaluation_outcome: Option<String>,
    evaluation_tries: i32,
    score: Option<f64>,
    score_details: Option<String>,
    public_score: Option<f64>,
    public_score_details: Option<String>,
    ranking_score_details: Option<Vec<String>>,
}

impl TryFrom<ResultRow> for SubmissionResult {
    type Error = sqlx::Error;

    /// # Errors
    ///
    /// Returns [`sqlx::Error::ColumnDecode`] naming the column when an enum column
    /// holds a value its enum does not declare.
    fn try_from(row: ResultRow) -> Result<Self, Self::Error> {
        Ok(Self {
            submission_id: SubmissionId(row.submission_id),
            dataset_id: DatasetId(row.dataset_id),
            compilation_outcome: outcome(
                "compilation_outcome",
                row.compilation_outcome,
                CompilationOutcome::parse,
            )?,
            compilation_tries: row.compilation_tries,
            evaluation_outcome: outcome(
                "evaluation_outcome",
                row.evaluation_outcome,
                EvaluationOutcome::parse,
            )?,
            evaluation_tries: row.evaluation_tries,
            score: row.score,
            score_details: row.score_details,
            public_score: row.public_score,
            public_score_details: row.public_score_details,
            ranking_score_details: row.ranking_score_details,
        })
    }
}

/// Parses one enum column, naming it when the value is outside the enum.
fn outcome<T>(
    column: &'static str,
    value: Option<String>,
    parse: impl Fn(&str) -> Option<T>,
) -> Result<Option<T>, sqlx::Error> {
    match value {
        None => Ok(None),
        Some(text) => parse(&text)
            .map(Some)
            .ok_or_else(|| sqlx::Error::ColumnDecode {
                index: column.to_string(),
                source: format!("{text:?} is not a value of {column}").into(),
            }),
    }
}
