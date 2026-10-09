use std::collections::BTreeMap;

use serde::Serialize;
use sqlx::postgres::{PgPool, PgRow};

use crate::store::StoreError;

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
    "SELECT key, name, begin, \"end\", score_precision FROM ranking_contests ORDER BY key";
const CONTESTS_ONE: &str =
    "SELECT key, name, begin, \"end\", score_precision FROM ranking_contests WHERE key = $1";
const TASKS_LIST: &str = "SELECT key, name, short_name, contest, max_score, extra_headers, \
    display_order, score_mode, score_precision FROM ranking_tasks ORDER BY display_order, key";
const TASKS_ONE: &str = "SELECT key, name, short_name, contest, max_score, extra_headers, \
    display_order, score_mode, score_precision FROM ranking_tasks WHERE key = $1";
const TEAMS_LIST: &str = "SELECT key, name FROM ranking_teams ORDER BY key";
const TEAMS_ONE: &str = "SELECT key, name FROM ranking_teams WHERE key = $1";
const USERS_LIST: &str = "SELECT key, f_name, l_name, team FROM ranking_users ORDER BY key";
const USERS_ONE: &str = "SELECT key, f_name, l_name, team FROM ranking_users WHERE key = $1";

pub async fn list_body(pool: &PgPool, kind: Kind) -> Result<Vec<u8>, StoreError> {
    match kind {
        Kind::Contest => {
            let rows = rows::<Contest>(pool, CONTESTS_LIST).await?;
            encode(&map_by_key(rows))
        }
        Kind::Task => {
            let rows = rows::<Task>(pool, TASKS_LIST).await?;
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
/// and extra come from the scorer, not the bare submission row.
pub async fn sublist_body(pool: &PgPool, user: &str) -> Result<Vec<u8>, StoreError> {
    let ledger = crate::store::load_ledger(pool).await?;
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
