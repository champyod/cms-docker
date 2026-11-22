//! The submission search: the criteria an admin or a service asks with, in one query.
//!
//! The reference returns a lazy `Query` and declares no order, so the rows keep the
//! database's; only the criteria decide which rows exist.

use chrono::NaiveDateTime;
use sqlx::postgres::{PgConnection, Postgres};
use sqlx::QueryBuilder;

use crate::reads::{submission_from_row, SubmissionId};

use super::filter::{SearchError, SubmissionFilter};
use super::Submission;

/// The eight columns a whole `submissions` row is read with, under the alias the joins need.
///
/// A search reads the same row `SUBMISSION_JUDGING_BY_ID` names, plus the comment and
/// opaque handle the panel shows, because the reference returns the whole object.
const SUBMISSION_COLUMNS: &str = "\
    SELECT s.id, s.opaque_id, s.task_id, s.participation_id, s.timestamp,
           s.language, s.comment, s.official \
    FROM submissions AS s";

/// The driver-facing shape of a row, before its fields are the record's.
#[derive(Debug, sqlx::FromRow)]
struct SubmissionRow {
    id: i32,
    opaque_id: i64,
    task_id: i32,
    participation_id: i32,
    timestamp: NaiveDateTime,
    language: Option<String>,
    comment: String,
    official: bool,
}

/// Every submission that matches `filter`, as the whole row the reference returns.
///
/// # Errors
///
/// Returns [`SearchError::Superfluous`] for a pair of criteria one of which implies
/// the other, and [`SearchError::Database`] for a statement the driver refused.
pub async fn get_submissions(
    connection: &mut PgConnection,
    filter: &SubmissionFilter,
) -> Result<Vec<Submission>, SearchError> {
    filter.validate()?;
    let mut query = statement(filter);
    let rows = query
        .build_query_as::<SubmissionRow>()
        .fetch_all(connection)
        .await?;
    Ok(rows.into_iter().map(whole).collect())
}

/// Pairs the judging record with the two columns only a whole-row read carries.
fn whole(row: SubmissionRow) -> Submission {
    Submission {
        record: submission_from_row(
            SubmissionId(row.id),
            row.task_id,
            row.participation_id,
            row.timestamp,
            row.language,
            row.official,
        ),
        opaque_id: row.opaque_id,
        comment: row.comment,
    }
}

/// The statement `filter` asks for, with joins only where a criterion needs them.
fn statement(filter: &SubmissionFilter) -> QueryBuilder<Postgres> {
    let mut query = QueryBuilder::new(SUBMISSION_COLUMNS);
    if filter.participation_id.is_some() || filter.contest_id.is_some() {
        query.push(" JOIN participations AS p ON p.id = s.participation_id");
    }
    let mut first = true;
    if let Some(id) = filter.submission_id {
        push_predicate(&mut query, &mut first, "s.id = ");
        query.push_bind(id.0);
    }
    if let Some(id) = filter.participation_id {
        push_predicate(&mut query, &mut first, "p.id = ");
        query.push_bind(id);
    }
    if let Some(id) = filter.task_id {
        push_predicate(&mut query, &mut first, "s.task_id = ");
        query.push_bind(id);
    }
    if let Some(id) = filter.contest_id {
        push_predicate(&mut query, &mut first, "p.contest_id = ");
        query.push_bind(id);
        query.push(" AND ");
        query.push(
            "EXISTS (SELECT 1 FROM contest_tasks AS ct \
             WHERE ct.task_id = s.task_id AND ct.contest_id = ",
        );
        query.push_bind(id);
        query.push(")");
    }
    query
}

/// Starts the `WHERE` clause, or continues it, before one predicate.
pub(super) fn push_predicate(
    query: &mut QueryBuilder<Postgres>,
    first: &mut bool,
    predicate: &str,
) {
    query.push(if *first { " WHERE " } else { " AND " });
    *first = false;
    query.push(predicate);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::reads::SubmissionId;

    /// The statement one filter asks for, as the driver would see it.
    fn sql(filter: &SubmissionFilter) -> String {
        statement(filter).into_sql().as_str().to_string()
    }

    #[test]
    fn no_criterion_selects_every_submission() {
        let sql = sql(&SubmissionFilter::default());

        assert!(sql.contains("FROM submissions AS s"));
        assert!(!sql.contains("JOIN"));
        assert!(!sql.contains("WHERE"));
    }

    #[test]
    fn a_participation_joins_the_participations_and_a_task_does_not() {
        let by_participation = sql(&SubmissionFilter {
            participation_id: Some(12),
            ..SubmissionFilter::default()
        });
        let by_task = sql(&SubmissionFilter {
            task_id: Some(7),
            ..SubmissionFilter::default()
        });

        assert!(by_participation.contains("JOIN participations"));
        assert!(by_participation.contains("p.id = $1"));
        assert!(!by_task.contains("JOIN"));
        assert!(by_task.contains("s.task_id = $1"));
    }

    #[test]
    fn a_contest_scope_is_the_participations_contest_and_the_tasks_membership() {
        let sql = sql(&SubmissionFilter {
            contest_id: Some(3),
            ..SubmissionFilter::default()
        });

        assert!(sql.contains("p.contest_id = $1"));
        assert!(sql.contains("FROM contest_tasks AS ct"));
        assert!(sql.contains("ct.contest_id = $2"));
    }

    #[test]
    fn a_submission_id_is_compared_as_the_column_holds_it() {
        let sql = sql(&SubmissionFilter {
            submission_id: Some(SubmissionId(41)),
            ..SubmissionFilter::default()
        });

        assert!(sql.contains("s.id = $1"));
    }
}
