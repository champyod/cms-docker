//! The two contest reads `util.py` keeps: the whole list and the membership check.
//!
//! `get_contest_list` is `session.query(Contest).all()`, which declares no order, so
//! the rows keep the database's own. `is_contest_id` asks only whether the row exists.

use sqlx::postgres::PgConnection;

use super::model::Contest;
use super::rows::ContestRow;

/// Every `contests` row, in the order the table returns them.
pub const CONTEST_LIST: &str = "\
    SELECT id, name, description, allowed_localizations, languages,
           submissions_download_allowed, allow_questions, allow_user_tests,
           allow_unofficial_submission_before_analysis_mode, block_hidden_participations,
           allow_password_authentication, allow_registration, ip_restriction, ip_autologin,
           token_mode, token_max_number, token_min_interval,
           token_gen_initial, token_gen_number, token_gen_interval, token_gen_max,
           start, stop, analysis_enabled, analysis_start, analysis_stop,
           timezone, per_user_time, max_submission_number, max_user_test_number,
           min_submission_interval, min_submission_interval_grace_period, min_user_test_interval,
           evaluation_throttle_delay_s, evaluation_throttle_window_s, evaluation_throttle_max,
           evaluation_final_open, evaluation_final_open_at, queue_fairness_penalty_seconds,
           score_precision, is_active
    FROM contests";

/// Whether `contests` holds a row with the id given as `$1`.
pub const CONTEST_EXISTS: &str = "SELECT EXISTS (SELECT 1 FROM contests WHERE id = $1)";

/// Every contest in the database.
///
/// # Errors
///
/// Returns the driver's own error for a row it could not read, and
/// [`sqlx::Error::ColumnDecode`] for a name or token mode the column refuses.
pub async fn get_contest_list(connection: &mut PgConnection) -> Result<Vec<Contest>, sqlx::Error> {
    let rows = sqlx::query_as::<_, ContestRow>(CONTEST_LIST)
        .fetch_all(connection)
        .await?;
    rows.into_iter().map(Contest::try_from).collect()
}

/// Whether a contest with `contest_id` exists.
///
/// # Errors
///
/// Returns the driver's own error for a statement it could not run.
pub async fn is_contest_id(
    connection: &mut PgConnection,
    contest_id: i32,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar::<_, bool>(CONTEST_EXISTS)
        .bind(contest_id)
        .fetch_one(connection)
        .await
}
