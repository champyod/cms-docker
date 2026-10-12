use std::collections::BTreeMap;

use serde::Serialize;
use sqlx::postgres::PgPool;

use crate::board::{self, BoardEntry, TeamEntry, UserNames};
use crate::overrides::{OverrideRow, Overrides};
use crate::scoring::{self, Ledger, ScoreError, ScoreMode, Subchange, Submission, TaskMode};

mod admin;

pub use admin::{
    load_admin_permissions, load_admin_user, touch_last_login, AdminPermissions, AdminUser,
    RANKING_READ_PERMISSION,
};

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error(transparent)]
    Score(#[from] ScoreError),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error("no database is configured")]
    NoDatabase,
}

/// Everything the board endpoints derive from one projection read: the ledger, the
/// names, the teams and the overrides. Built once per data change and shared, so a
/// page load (board + teams + scores + history) does not replay the whole contest
/// four times.
pub struct Standings {
    pub ledger: Ledger,
    pub users: BTreeMap<String, UserNames>,
    pub team_names: BTreeMap<String, String>,
    pub overrides: Overrides,
}

/// Holds one built [`Standings`] and drops it on invalidation. The first reader to find
/// it empty rebuilds while the others wait on the lock, so the four endpoints a page
/// load hits cost one rebuild rather than one each.
#[derive(Clone, Default)]
pub struct StandingsCache {
    inner: std::sync::Arc<tokio::sync::Mutex<Option<std::sync::Arc<Standings>>>>,
}

impl StandingsCache {
    pub async fn invalidate(&self) {
        let mut guard = self.inner.lock().await;
        *guard = None;
    }

    pub async fn get_or_build<F, Fut>(
        &self,
        build: F,
    ) -> Result<std::sync::Arc<Standings>, StoreError>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<Standings, StoreError>>,
    {
        let mut guard = self.inner.lock().await;
        if let Some(cached) = guard.as_ref() {
            return Ok(cached.clone());
        }
        let built = std::sync::Arc::new(build().await?);
        *guard = Some(built.clone());
        Ok(built)
    }
}

pub async fn load_standings(
    pool: &PgPool,
    contest_id: Option<i64>,
) -> Result<Standings, StoreError> {
    let users = load_users(pool).await?;
    let team_names = load_team_names(pool).await?;
    let overrides = load_overrides(pool, contest_id).await?;
    let ledger = assemble_ledger(pool, &users, &overrides).await?;
    Ok(Standings {
        ledger,
        users,
        team_names,
        overrides,
    })
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

    /// Whether the panel starts the board anonymous, so a visitor sees no name until
    /// they turn it off. Names are hidden, not blanked: the rows stay where they are.
    pub fn anonymous(&self) -> bool {
        self.columns
            .as_ref()
            .and_then(|columns| columns.get("anonymous"))
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false)
    }
}

pub async fn load_ledger(pool: &PgPool, contest_id: Option<i64>) -> Result<Ledger, StoreError> {
    let users = load_users(pool).await?;
    let overrides = load_overrides(pool, contest_id).await?;
    assemble_ledger(pool, &users, &overrides).await
}

/// The board the page draws: the ledger's override-shaped rows joined with the names
/// and team the projection holds, so a reader gets a name already renamed and a rank
/// already assigned instead of recomputing either.
pub async fn load_board(
    pool: &PgPool,
    contest_id: Option<i64>,
) -> Result<BTreeMap<String, BoardEntry>, StoreError> {
    let standings = load_standings(pool, contest_id).await?;
    Ok(board::board_view(
        standings.ledger.board(),
        &standings.users,
    ))
}

/// The team board: the same rows grouped by team, with a team-level override applied to
/// the aggregate rather than to each member.
pub async fn load_team_board(
    pool: &PgPool,
    contest_id: Option<i64>,
) -> Result<BTreeMap<String, TeamEntry>, StoreError> {
    let standings = load_standings(pool, contest_id).await?;
    Ok(board::team_board_view(
        standings.ledger.board(),
        &standings.users,
        &standings.team_names,
        &standings.overrides,
    ))
}

async fn assemble_ledger(
    pool: &PgPool,
    users: &BTreeMap<String, UserNames>,
    overrides: &Overrides,
) -> Result<Ledger, StoreError> {
    let tasks = load_tasks(pool).await?;
    let submissions = load_submissions(pool).await?;
    let subchanges = load_subchanges(pool).await?;
    let teams: BTreeMap<String, String> = users
        .iter()
        .filter_map(|(key, user)| user.team.clone().map(|team| (key.clone(), team)))
        .collect();
    Ok(scoring::assemble_with(
        &tasks,
        &submissions,
        &subchanges,
        overrides,
        &teams,
    )?)
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

#[derive(sqlx::FromRow)]
struct OverrideRowRecord {
    target_kind: String,
    target_key: String,
    action: String,
    payload: Option<serde_json::Value>,
}

/// The active overrides in one query, folded for the board assembly. Only active rows
/// apply: an ended override keeps its history in the table but not on the board.
async fn load_overrides(pool: &PgPool, contest_id: Option<i64>) -> Result<Overrides, StoreError> {
    let rows = sqlx::query_as::<_, OverrideRowRecord>(
        "SELECT target_kind, target_key, action, payload FROM ranking_overrides \
         WHERE active AND ($1::bigint IS NULL OR contest_id = $1) ORDER BY id",
    )
    .bind(contest_id)
    .fetch_all(pool)
    .await?;
    let rows: Vec<OverrideRow> = rows
        .into_iter()
        .map(|row| OverrideRow {
            target_kind: row.target_kind,
            target_key: row.target_key,
            action: row.action,
            payload: row.payload,
        })
        .collect();
    Ok(Overrides::fold(&rows))
}

#[derive(sqlx::FromRow)]
struct TeamRow {
    key: String,
    name: String,
}

/// The team keys and their display names, so the team board names a team without a
/// query per row.
async fn load_team_names(pool: &PgPool) -> Result<BTreeMap<String, String>, StoreError> {
    let rows = sqlx::query_as::<_, TeamRow>("SELECT key, name FROM ranking_teams")
        .fetch_all(pool)
        .await?;
    Ok(rows.into_iter().map(|row| (row.key, row.name)).collect())
}

#[derive(sqlx::FromRow)]
struct UserRow {
    key: String,
    f_name: String,
    l_name: String,
    team: Option<String>,
}

/// Who each projected user is, so the board can name a row and a team override can
/// reach its members without a query per row.
async fn load_users(pool: &PgPool) -> Result<BTreeMap<String, UserNames>, StoreError> {
    let rows = sqlx::query_as::<_, UserRow>("SELECT key, f_name, l_name, team FROM ranking_users")
        .fetch_all(pool)
        .await?;
    Ok(rows
        .into_iter()
        .map(|row| {
            (
                row.key,
                UserNames {
                    f_name: row.f_name,
                    l_name: row.l_name,
                    team: row.team,
                },
            )
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    fn empty_standings() -> Standings {
        Standings {
            ledger: Ledger::default(),
            users: BTreeMap::new(),
            team_names: BTreeMap::new(),
            overrides: Overrides::default(),
        }
    }

    /// The reason the cache exists: the four board endpoints a page load hits share one
    /// build, and a rebuild happens only after a projection change invalidates it.
    #[tokio::test]
    async fn the_cache_builds_once_until_invalidated() {
        let cache = StandingsCache::default();
        let builds = Arc::new(AtomicUsize::new(0));
        for _ in 0..5 {
            let counter = builds.clone();
            cache
                .get_or_build(|| async move {
                    counter.fetch_add(1, Ordering::SeqCst);
                    Ok(empty_standings())
                })
                .await
                .expect("the build succeeds");
        }
        assert_eq!(builds.load(Ordering::SeqCst), 1, "five reads, one build");

        cache.invalidate().await;
        let counter = builds.clone();
        cache
            .get_or_build(|| async move {
                counter.fetch_add(1, Ordering::SeqCst);
                Ok(empty_standings())
            })
            .await
            .expect("the rebuild succeeds");
        assert_eq!(
            builds.load(Ordering::SeqCst),
            2,
            "an invalidation costs one rebuild"
        );
    }
}
