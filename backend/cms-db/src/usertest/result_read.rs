//! The stored `user_test_results` row, read before a new result is written.
//!
//! A user-test evaluation writes only its own half of the row, so the compiler's
//! outcome, text and measurements have to survive it (`Job.py:738-760`). This
//! read is the only way to get that half back; it maps the same columns the
//! write path binds and refuses a stored value outside their domains.

use sqlx::postgres::PgConnection;

use crate::reads::DatasetId;
use crate::writes::{CompilationOutcome, EvaluationOutcome};

use super::result::UserTestResult;

/// The result row of one user test on one dataset, or `None` when never judged.
pub const USER_TEST_RESULT_BY_ID: &str = "\
    SELECT user_test_id, dataset_id, output, compilation_outcome, compilation_text, \
        compilation_tries, compilation_stdout, compilation_stderr, compilation_time, \
        compilation_wall_clock_time, compilation_memory, compilation_shard, \
        compilation_sandbox_paths, compilation_sandbox_digests, evaluation_outcome, \
        evaluation_text, evaluation_tries, execution_time, execution_wall_clock_time, \
        execution_memory, evaluation_shard, evaluation_sandbox_paths, \
        evaluation_sandbox_digests \
    FROM user_test_results WHERE user_test_id = $1 AND dataset_id = $2";

/// Why a stored result row could not be mapped into [`UserTestResult`].
#[derive(Debug, thiserror::Error)]
pub enum UserTestResultReadError {
    /// The driver refused the read.
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    /// `output` does not hold a valid digest.
    #[error("user test result output is not a valid digest: {0}")]
    BadOutput(String),
    /// One of the result's two outcome columns holds an unknown value.
    #[error("user test result {column} holds an unknown outcome: {value}")]
    BadOutcome {
        /// The column that held the value.
        column: &'static str,
        /// The value the column held.
        value: String,
    },
}

/// Read one stored user-test result by its composite key.
///
/// # Errors
///
/// Returns [`UserTestResultReadError::Database`] for a refused read and a named
/// mapping refusal for a digest or outcome the domains would not accept.
pub async fn user_test_result(
    connection: &mut PgConnection,
    user_test_id: i32,
    dataset_id: DatasetId,
) -> Result<Option<UserTestResult>, UserTestResultReadError> {
    let row = sqlx::query_as::<_, StoredRow>(USER_TEST_RESULT_BY_ID)
        .bind(user_test_id)
        .bind(dataset_id.0)
        .fetch_optional(connection)
        .await?;
    row.map(UserTestResult::try_from).transpose()
}

/// The row exactly as the driver decodes it, before domain checks.
#[derive(Debug, sqlx::FromRow)]
struct StoredRow {
    user_test_id: i32,
    dataset_id: i32,
    output: Option<String>,
    compilation_outcome: Option<String>,
    compilation_text: Vec<String>,
    compilation_tries: i32,
    compilation_stdout: Option<String>,
    compilation_stderr: Option<String>,
    compilation_time: Option<f64>,
    compilation_wall_clock_time: Option<f64>,
    compilation_memory: Option<i64>,
    compilation_shard: Option<i32>,
    compilation_sandbox_paths: Option<Vec<String>>,
    compilation_sandbox_digests: Option<Vec<String>>,
    evaluation_outcome: Option<String>,
    evaluation_text: Vec<String>,
    evaluation_tries: i32,
    execution_time: Option<f64>,
    execution_wall_clock_time: Option<f64>,
    execution_memory: Option<i64>,
    evaluation_shard: Option<i32>,
    evaluation_sandbox_paths: Option<Vec<String>>,
    evaluation_sandbox_digests: Option<Vec<String>>,
}

impl TryFrom<StoredRow> for UserTestResult {
    type Error = UserTestResultReadError;

    fn try_from(row: StoredRow) -> Result<Self, Self::Error> {
        let ParsedDomains {
            output,
            compilation_outcome,
            evaluation_outcome,
        } = parse_domains(&row)?;
        Ok(Self {
            user_test_id: row.user_test_id,
            dataset_id: row.dataset_id,
            output,
            compilation_outcome,
            compilation_text: row.compilation_text,
            compilation_tries: row.compilation_tries,
            compilation_stdout: row.compilation_stdout,
            compilation_stderr: row.compilation_stderr,
            compilation_time: row.compilation_time,
            compilation_wall_clock_time: row.compilation_wall_clock_time,
            compilation_memory: row.compilation_memory,
            compilation_shard: row.compilation_shard,
            compilation_sandbox_paths: row.compilation_sandbox_paths,
            compilation_sandbox_digests: row.compilation_sandbox_digests,
            evaluation_outcome,
            evaluation_text: row.evaluation_text,
            evaluation_tries: row.evaluation_tries,
            execution_time: row.execution_time,
            execution_wall_clock_time: row.execution_wall_clock_time,
            execution_memory: row.execution_memory,
            evaluation_shard: row.evaluation_shard,
            evaluation_sandbox_paths: row.evaluation_sandbox_paths,
            evaluation_sandbox_digests: row.evaluation_sandbox_digests,
            executables: std::collections::BTreeMap::new(),
        })
    }
}

/// The three stored columns whose values need domain checks.
struct ParsedDomains {
    output: Option<crate::digest::FileDigest>,
    compilation_outcome: Option<CompilationOutcome>,
    evaluation_outcome: Option<EvaluationOutcome>,
}

/// Reads the three columns that need domain checks before the row is built.
fn parse_domains(row: &StoredRow) -> Result<ParsedDomains, UserTestResultReadError> {
    let output = row
        .output
        .as_deref()
        .map(|text| {
            text.parse()
                .map_err(|_| UserTestResultReadError::BadOutput(text.to_owned()))
        })
        .transpose()?;
    let compilation_outcome = parse_outcome(
        "compilation_outcome",
        row.compilation_outcome.clone(),
        CompilationOutcome::parse,
    )?;
    let evaluation_outcome = parse_outcome(
        "evaluation_outcome",
        row.evaluation_outcome.clone(),
        EvaluationOutcome::parse,
    )?;
    Ok(ParsedDomains {
        output,
        compilation_outcome,
        evaluation_outcome,
    })
}

fn parse_outcome<T>(
    column: &'static str,
    value: Option<String>,
    parse: impl FnOnce(&str) -> Option<T>,
) -> Result<Option<T>, UserTestResultReadError> {
    let Some(value) = value else {
        return Ok(None);
    };
    parse(&value)
        .map(Some)
        .ok_or(UserTestResultReadError::BadOutcome { column, value })
}
