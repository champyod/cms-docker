use std::collections::BTreeMap;

use serde::Serialize;
use sqlx::postgres::{PgPool, PgRow};

use crate::overrides::load_hidden_tasks;
use crate::store::{ShownSet, StoreError};

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Contest {
    #[serde(skip)]
    pub key: String,
    pub name: String,
    pub begin: i32,
    pub end: i32,
    pub score_precision: i32,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Task {
    #[serde(skip)]
    pub key: String,
    pub name: String,
    pub short_name: String,
    pub contest: String,
    pub max_score: f64,
    pub extra_headers: serde_json::Value,
    /// The projection column is display_order; the page kept the payload name.
    #[serde(rename = "order")]
    pub display_order: i32,
    pub score_mode: String,
    pub score_precision: i32,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Team {
    #[serde(skip)]
    pub key: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct User {
    #[serde(skip)]
    pub key: String,
    pub f_name: String,
    pub l_name: String,
    pub team: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Contest,
    Task,
    Team,
    User,
}

const CONTESTS_LIST: &str =
    "SELECT key, name, begin, \"end\", score_precision FROM ranking_contests \
     WHERE contest_id = ANY($1) ORDER BY key";
const CONTESTS_ONE: &str =
    "SELECT key, name, begin, \"end\", score_precision FROM ranking_contests WHERE key = $1";
const TASKS_LIST: &str = "SELECT key, name, short_name, contest, max_score, extra_headers, \
    display_order, score_mode, score_precision FROM ranking_tasks \
    WHERE contest_id = ANY($1) ORDER BY display_order, key";
const TASKS_ONE: &str = "SELECT key, name, short_name, contest, max_score, extra_headers, \
    display_order, score_mode, score_precision FROM ranking_tasks WHERE key = $1";
const TEAMS_LIST: &str = "SELECT key, name FROM ranking_teams ORDER BY key";
const TEAMS_ONE: &str = "SELECT key, name FROM ranking_teams WHERE key = $1";
const USERS_LIST: &str = "SELECT key, f_name, l_name, team FROM ranking_users ORDER BY key";
const USERS_ONE: &str = "SELECT key, f_name, l_name, team FROM ranking_users WHERE key = $1";

/// The entity list the page polls, scoped to the contests the config shows. WHY the scope is here
/// and not only in the ledger: the page builds its columns from the task metadata this list
/// returns, so a list that carried another contest's tasks would let the page draw a column the
/// ledger has no scores for. One scope, both lists.
///
/// WHY it is filtered here: a hidden contest or task keeps its row, its dataset and its metadata,
/// and only the board drops it, so the target has to leave the list the page builds from rather
/// than the row itself.
///
/// WHY one small load feeds both arms: a contest hide drops the contest and every task filed
/// under it, and a task hide drops a task only inside its contest, so the contest list and the
/// task list read one interpretation rather than two. The load is the one-query
/// `load_hidden_tasks`, not the whole override fold, because /tasks/ is polled constantly and
/// needs no user, team or score override.
pub async fn list_body(pool: &PgPool, kind: Kind, shown: &ShownSet) -> Result<Vec<u8>, StoreError> {
    match kind {
        Kind::Contest => {
            let hidden = load_hidden_tasks(pool, shown.contest_ids()).await?;
            let rows: Vec<Contest> = rows_scoped::<Contest>(pool, CONTESTS_LIST, shown)
                .await?
                .into_iter()
                .filter(|contest| !hidden.hides_contest(&contest.key))
                .collect();
            encode(&map_by_key(rows))
        }
        Kind::Task => {
            let hidden = load_hidden_tasks(pool, shown.contest_ids()).await?;
            let rows: Vec<Task> = rows_scoped::<Task>(pool, TASKS_LIST, shown)
                .await?
                .into_iter()
                .filter(|task| {
                    !hidden.hides_contest(&task.contest)
                        && !hidden.hides_task(&task.contest, &task.key)
                })
                .collect();
            encode(&map_by_key(rows))
        }
        Kind::Team => {
            let rows = rows::<Team>(pool, TEAMS_LIST).await?;
            encode(&map_by_key(rows))
        }
        Kind::User => {
            let rows = rows::<User>(pool, USERS_LIST).await?;
            encode(&map_by_key(rows))
        }
    }
}

pub async fn one_body(pool: &PgPool, kind: Kind, key: &str) -> Result<Option<Vec<u8>>, StoreError> {
    match kind {
        Kind::Contest => one::<Contest>(pool, CONTESTS_ONE, key).await,
        Kind::Task => one::<Task>(pool, TASKS_ONE, key).await,
        Kind::Team => one::<Team>(pool, TEAMS_ONE, key).await,
        Kind::User => one::<User>(pool, USERS_ONE, key).await,
    }
}

/// The per-user submission list the page polls; an empty list is the honest answer
/// for a user who has none, so this is never a 404. The per-submission score, token
/// and extra come from the scorer, not the bare submission row. It reads the shared
/// ledger rather than rebuilding one, because the caller already holds it.
pub fn sublist_body(ledger: &crate::scoring::Ledger, user: &str) -> Result<Vec<u8>, StoreError> {
    encode(&ledger.sublist(user))
}

fn map_by_key<T: Keyed>(rows: Vec<T>) -> BTreeMap<String, T> {
    rows.into_iter()
        .map(|row| (row.key().to_string(), row))
        .collect()
}

fn encode<T: Serialize>(value: &T) -> Result<Vec<u8>, StoreError> {
    Ok(crate::json::to_bytes(value)?)
}

async fn rows<T>(pool: &PgPool, sql: &'static str) -> Result<Vec<T>, StoreError>
where
    T: for<'r> sqlx::FromRow<'r, PgRow> + Send + Unpin,
{
    Ok(sqlx::query_as::<_, T>(sql).fetch_all(pool).await?)
}

/// The scoped twin of [`rows`]: one bind, the shown contests, for the two lists that carry a
/// contest id.
async fn rows_scoped<T>(
    pool: &PgPool,
    sql: &'static str,
    shown: &ShownSet,
) -> Result<Vec<T>, StoreError>
where
    T: for<'r> sqlx::FromRow<'r, PgRow> + Send + Unpin,
{
    Ok(sqlx::query_as::<_, T>(sql)
        .bind(shown.contest_ids())
        .fetch_all(pool)
        .await?)
}

async fn one<T>(pool: &PgPool, sql: &'static str, key: &str) -> Result<Option<Vec<u8>>, StoreError>
where
    T: for<'r> sqlx::FromRow<'r, PgRow> + Serialize + Send + Unpin,
{
    let row = sqlx::query_as::<_, T>(sql)
        .bind(key)
        .fetch_optional(pool)
        .await?;
    match row {
        Some(row) => Ok(Some(encode(&row)?)),
        None => Ok(None),
    }
}

/// The list key lives on the row and is skipped on the wire, so this keeps the two
/// from being built from different fields.
trait Keyed {
    fn key(&self) -> &str;
}

impl Keyed for Contest {
    fn key(&self) -> &str {
        &self.key
    }
}

impl Keyed for Task {
    fn key(&self) -> &str {
        &self.key
    }
}

impl Keyed for Team {
    fn key(&self) -> &str {
        &self.key
    }
}

impl Keyed for User {
    fn key(&self) -> &str {
        &self.key
    }
}
