//! How many submissions sit in each status: `server.py:112-201`, counted over each task's active dataset.
//!
//! `submissions` drives the scan, so the total is every submission in scope and a submission whose active
//! dataset has no result row arrives with nothing attached — the case the reconciliation exists for.
//! A contest restricts the scan through the submission's participation, never its task.

use cms_db::{CompilationOutcome, DatasetId, EvaluationOutcome, SubmissionId, SubmissionResult};
use cms_grading::limits::{MAX_COMPILATION_TRIES, MAX_EVALUATION_TRIES};
use sqlx::postgres::{PgConnection, Postgres};
use sqlx::{FromRow, QueryBuilder};

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

/// Submissions per status, plus the total the gauge reports beside them.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct StatusCounts {
    /// Not compiled yet, or in no status at all: the reconciliation adds the unclassified here.
    pub compiling: i64,
    /// Not compiled, and the compilation attempts are spent.
    pub max_compilations: i64,
    /// `compilation_outcome = 'fail'`, so the submission itself was rejected.
    pub compilation_fail: i64,
    /// Compiled, not evaluated, and the evaluation attempts are not spent.
    pub evaluating: i64,
    /// Compiled, not evaluated, and the evaluation attempts are spent.
    pub max_evaluations: i64,
    /// Evaluated, and the five score columns are not all filled.
    pub scoring: i64,
    /// Evaluated, and all five score columns are filled.
    pub scored: i64,
    /// Every submission in scope, whether or not its active dataset has a result row.
    pub total: i64,
}

/// The seven statuses and the total, for `contest_id`'s submissions or for all of them when `None`.
///
/// The reference's docstring says six statuses; what it returns is these seven plus `total`, and the
/// gauge reads the dict.
///
/// # Errors
///
/// Returns the driver's own error for a statement it refused, and a `ColumnDecode` naming the column
/// when an outcome holds a value the enum does not declare.
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

/// The reference's buckets over the rows read, then its reconciliation of what they left out.
fn count(results: &[Option<SubmissionResult>]) -> StatusCounts {
    let mut counts = StatusCounts {
        total: results.len() as i64,
        ..StatusCounts::default()
    };
    for result in results.iter().flatten() {
        counts.add(result);
    }
    counts.reconcile();
    counts
}

impl StatusCounts {
    /// Counts one result in the bucket the reference counts it in, in the reference's order.
    fn add(&mut self, result: &SubmissionResult) {
        if !result.compiled() {
            if result.compilation_tries < MAX_COMPILATION_TRIES {
                self.compiling += 1;
            } else {
                self.max_compilations += 1;
            }
        } else if result.compilation_failed() {
            self.compilation_fail += 1;
        } else if result.compilation_succeeded() {
            if !result.evaluated() {
                if result.evaluation_tries < MAX_EVALUATION_TRIES {
                    self.evaluating += 1;
                } else {
                    self.max_evaluations += 1;
                }
            } else if result.scored() {
                self.scored += 1;
            } else {
                self.scoring += 1;
            }
        }
        // A compiled outcome that is neither `ok` nor `fail` fits no bucket here, as in the reference.
    }

    /// Reports every submission no bucket classified as compiling, where the dashboard can see it.
    fn reconcile(&mut self) {
        // WHY the sum includes `compiling` and `total`: the reference adds `2*total - sum(stats)`, where its own
        // `compiling` cancels out and leaves total minus every other bucket — the unclassified included.
        let sum = self.total
            + self.compiling
            + self.max_compilations
            + self.compilation_fail
            + self.evaluating
            + self.max_evaluations
            + self.scoring
            + self.scored;
        self.compiling += 2 * self.total - sum;
    }
}

/// One `submissions` row and its active-dataset result, before the two outcome columns are typed.
#[derive(Debug, FromRow)]
struct StatusRow {
    submission_id: i32,
    dataset_id: Option<i32>,
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

#[cfg(test)]
mod tests {
    use super::*;

    /// A result whose compilation ended, with `tries` failures behind it.
    fn compiled(succeeded: bool, tries: i32) -> SubmissionResult {
        let mut result = SubmissionResult::new(SubmissionId(1), DatasetId(1));
        result.compilation_outcome = Some(if succeeded {
            CompilationOutcome::Ok
        } else {
            CompilationOutcome::Fail
        });
        result.compilation_tries = tries;
        result
    }

    /// A compiled result whose evaluation ended, with `tries` failures behind it.
    fn evaluated(tries: i32) -> SubmissionResult {
        let mut result = compiled(true, 0);
        result.evaluation_outcome = Some(EvaluationOutcome::Ok);
        result.evaluation_tries = tries;
        result
    }

    /// An evaluated result holding all five score columns.
    fn scored() -> SubmissionResult {
        let mut result = evaluated(0);
        result.score = Some(1.0);
        result.score_details = Some("{}".to_owned());
        result.public_score = Some(1.0);
        result.public_score_details = Some("{}".to_owned());
        result.ranking_score_details = Some(vec!["1".to_owned()]);
        result
    }

    #[test]
    fn the_reconciliation_reports_unclassified_submissions_as_compiling() {
        let rows = vec![
            Some(SubmissionResult::new(SubmissionId(1), DatasetId(1))),
            Some(SubmissionResult::new(SubmissionId(2), DatasetId(1))),
            Some(compiled(false, 1)),
            Some(compiled(true, 0)),
            Some(compiled(true, 0)),
            Some(compiled(true, 0)),
            Some(evaluated(0)),
            Some(scored()),
            None,
            None,
        ];
        assert_eq!(
            count(&rows),
            StatusCounts {
                compiling: 4,
                max_compilations: 0,
                compilation_fail: 1,
                evaluating: 3,
                max_evaluations: 0,
                scoring: 1,
                scored: 1,
                total: 10,
            },
            "two submissions no bucket classified must be reported, not dropped"
        );
    }

    #[test]
    fn the_attempt_caps_decide_the_exhausted_buckets() {
        let mut compiling = SubmissionResult::new(SubmissionId(1), DatasetId(1));
        compiling.compilation_tries = MAX_COMPILATION_TRIES - 1;
        let mut exhausted = SubmissionResult::new(SubmissionId(2), DatasetId(1));
        exhausted.compilation_tries = MAX_COMPILATION_TRIES;
        let mut evaluating = compiled(true, 0);
        evaluating.evaluation_tries = MAX_EVALUATION_TRIES - 1;
        let mut max_evaluations = compiled(true, 0);
        max_evaluations.evaluation_tries = MAX_EVALUATION_TRIES;

        let counts = count(&[
            Some(compiling),
            Some(exhausted),
            Some(evaluating),
            Some(max_evaluations),
        ]);
        assert_eq!(
            (
                counts.compiling,
                counts.max_compilations,
                counts.evaluating,
                counts.max_evaluations
            ),
            (1, 1, 1, 1),
            "the last allowed attempt and the first spent one must land in different buckets"
        );
    }
}
