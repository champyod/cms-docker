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

/// The entity kinds, named here for the routes that serve them and defined beside the shown set.
///
/// WHY the definition lives in `store`: "does the board draw this kind's key" is a question about
/// the scope, so the kind travels with it and this module only re-exports the name its callers
/// already use.
pub use crate::store::EntityKind as Kind;

/// The entity list the page polls, scoped to the contests the config shows. WHY the scope is here
/// and not only in the ledger: the page builds its columns from the task metadata this list
/// returns, so a list that carried another contest's tasks would let the page draw a column the
/// ledger has no scores for. One scope, every list.
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
            let rows: Vec<Contest> = drawn::<Contest>(pool, kind, None, shown)
                .await?
                .into_iter()
                .filter(|contest| !hidden.hides_contest(&contest.key))
                .collect();
            encode(&map_by_key(rows))
        }
        Kind::Task => {
            let hidden = load_hidden_tasks(pool, shown.contest_ids()).await?;
            let rows: Vec<Task> = drawn::<Task>(pool, kind, None, shown)
                .await?
                .into_iter()
                .filter(|task| {
                    !hidden.hides_contest(&task.contest)
                        && !hidden.hides_task(&task.contest, &task.key)
                })
                .collect();
            encode(&map_by_key(rows))
        }
        // Teams and users are shared across contests — a team has no contest of its own and a
        // user may compete in several — so neither list can be scoped by a column. They are
        // scoped by what the board draws them through instead: a submission on a shown contest's
        // task. Serving the whole directory here while the one-entity read refused part of it is
        // the same defect in a smaller place: two answers to what the board serves.
        Kind::Team => encode(&map_by_key(drawn::<Team>(pool, kind, None, shown).await?)),
        Kind::User => encode(&map_by_key(drawn::<User>(pool, kind, None, shown).await?)),
    }
}

/// One entity, refused when the board does not draw it.
///
/// WHY the shown set is a parameter rather than a second read: the route already loads it for the
/// same request, and the scope this read applies has to be the one the request was served under —
/// a config change between two reads of one request would otherwise answer halves of two boards.
/// A key outside the shown set is answered as a missing row, so the route's 404 is the same
/// answer it gives a key that never existed: the page then has nothing to render either way.
pub async fn one_body(
    pool: &PgPool,
    kind: Kind,
    key: &str,
    shown: &ShownSet,
) -> Result<Option<Vec<u8>>, StoreError> {
    match kind {
        Kind::Contest => one::<Contest>(pool, kind, key, shown).await,
        Kind::Task => one::<Task>(pool, kind, key, shown).await,
        Kind::Team => one::<Team>(pool, kind, key, shown).await,
        Kind::User => one::<User>(pool, kind, key, shown).await,
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

/// The rows of `kind` the board draws, narrowed to one key when the caller asks for one.
///
/// WHY there is no unscoped sibling any more: every entity this module serves is read through the
/// statement that owns the scope, so an entity the feed announces and an entity this module serves
/// cannot be two different sets — which is what the four unscoped `WHERE key = $1` reads were.
async fn drawn<T>(
    pool: &PgPool,
    kind: Kind,
    key: Option<&str>,
    shown: &ShownSet,
) -> Result<Vec<T>, StoreError>
where
    T: for<'r> sqlx::FromRow<'r, PgRow> + Send + Unpin,
{
    Ok(sqlx::query_as::<_, T>(kind.drawn())
        .bind(shown.contest_ids())
        .bind(key)
        .fetch_all(pool)
        .await?)
}

/// One row of `kind`, serialised, or None when the board does not draw it.
async fn one<T>(
    pool: &PgPool,
    kind: Kind,
    key: &str,
    shown: &ShownSet,
) -> Result<Option<Vec<u8>>, StoreError>
where
    T: for<'r> sqlx::FromRow<'r, PgRow> + Serialize + Send + Unpin,
{
    match drawn::<T>(pool, kind, Some(key), shown).await?.first() {
        Some(row) => Ok(Some(encode(row)?)),
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
