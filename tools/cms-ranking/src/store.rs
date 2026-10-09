use serde::Serialize;
use sqlx::postgres::PgPool;

use crate::scoring::{self, Ledger, ScoreError, ScoreMode, Subchange, Submission, TaskMode};

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error(transparent)]
    Score(#[from] ScoreError),
}

/// One console account. The password is verified by the auth module, not here, so
/// this stays a row and nothing more.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct ConsoleUser {
    pub id: i32,
    pub username: String,
    pub password: String,
}

#[derive(sqlx::FromRow)]
struct TaskRow {
    key: String,
    score_mode: String,
}

#[derive(sqlx::FromRow)]
struct SubmissionRow {
    key: String,
    user: String,
    task: String,
    time: i32,
}

#[derive(sqlx::FromRow)]
struct SubchangeRow {
    key: String,
    submission: String,
    time: i32,
    score: Option<f64>,
    token: Option<bool>,
    extra: Option<serde_json::Value>,
}

/// What the panel decides about how the scoreboard looks. Every field is optional
/// because the row may not exist yet, and the serving side falls back to the
/// vendored page defaults rather than inventing values.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Appearance {
    pub title: Option<String>,
    pub subtitle: Option<String>,
    pub organisation: Option<String>,
    pub logo_asset: Option<String>,
    pub favicon_asset: Option<String>,
    pub theme: Option<serde_json::Value>,
    pub columns: Option<serde_json::Value>,
    pub score_format: Option<serde_json::Value>,
    pub footer_text: Option<String>,
    pub credits_text: Option<String>,
    /// The panel's full credit list, when it has one.
    pub credits: Option<serde_json::Value>,
    pub access_mode: String,
}

impl Appearance {
    /// The scoreboard only learns whether to show the id column from this flag,
    /// so it is derived here rather than stored twice.
    pub fn show_id_column(&self) -> bool {
        self.columns
            .as_ref()
            .and_then(|columns| columns.get("show_id_column"))
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false)
    }
}

pub async fn load_ledger(pool: &PgPool) -> Result<Ledger, StoreError> {
    let tasks = load_tasks(pool).await?;
    let submissions = load_submissions(pool).await?;
    let subchanges = load_subchanges(pool).await?;
    Ok(scoring::assemble(&tasks, &submissions, &subchanges)?)
}

/// Only an enabled account is returned: a disabled row must read as no account, not
/// as an account whose password happens to fail.
pub async fn load_console_user(
    pool: &PgPool,
    username: &str,
) -> Result<Option<ConsoleUser>, StoreError> {
    let row = sqlx::query_as::<_, ConsoleUser>(
        "SELECT id, username, password FROM ranking_console_users WHERE username = $1 AND enabled",
    )
    .bind(username)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

pub async fn touch_last_login(pool: &PgPool, id: i32) -> Result<(), StoreError> {
    sqlx::query("UPDATE ranking_console_users SET last_login_at = now() WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn load_appearance(pool: &PgPool) -> Result<Option<Appearance>, StoreError> {
    let row = sqlx::query_as::<_, Appearance>(
        "SELECT title, subtitle, organisation, logo_asset, favicon_asset, theme, \
         columns, score_format, footer_text, credits_text, credits, access_mode \
         FROM ranking_settings WHERE id = 1",
    )
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

async fn load_tasks(pool: &PgPool) -> Result<Vec<TaskMode>, StoreError> {
    let rows = sqlx::query_as::<_, TaskRow>(
        "SELECT key, score_mode FROM ranking_tasks ORDER BY display_order, key",
    )
    .fetch_all(pool)
    .await?;
    rows.into_iter()
        .map(|row| {
            let mode = ScoreMode::from_wire(&row.score_mode).ok_or_else(|| {
                ScoreError::UnknownScoreMode {
                    task: row.key.clone(),
                    mode: row.score_mode.clone(),
                }
            })?;
            Ok(TaskMode { key: row.key, mode })
        })
        .collect()
}

async fn load_submissions(pool: &PgPool) -> Result<Vec<Submission>, StoreError> {
    let rows = sqlx::query_as::<_, SubmissionRow>(
        "SELECT key, \"user\", task, time FROM ranking_submissions ORDER BY time, key",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| Submission {
            key: row.key,
            user: row.user,
            task: row.task,
            time: i64::from(row.time),
        })
        .collect())
}

async fn load_subchanges(pool: &PgPool) -> Result<Vec<Subchange>, StoreError> {
    let rows = sqlx::query_as::<_, SubchangeRow>(
        "SELECT key, submission, time, score, token, extra FROM ranking_subchanges ORDER BY time, key",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| Subchange {
            key: row.key,
            submission: row.submission,
            time: i64::from(row.time),
            score: row.score,
            token: row.token,
            extra: row.extra.as_ref().and_then(to_scores),
        })
        .collect())
}

fn to_scores(value: &serde_json::Value) -> Option<Vec<f64>> {
    value.as_array().map(|values| {
        values
            .iter()
            .filter_map(serde_json::Value::as_f64)
            .collect()
    })
}
