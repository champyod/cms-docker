//! Which contest this ranking instance serves, read from the service registry.
//!
//! WHY the registry and not the environment: every other contest-scoped service in this stack
//! resolves its contest from the `services` row that names its own (role, shard), per call, behind
//! a short TTL — so re-pointing that row is what moves a service, with no container recreate. The
//! ranking is edited from the same panel and has to answer the same question the same way, or it
//! is the one service an operator has to redeploy to move.
//!
//! WHY the answer is only ever used to *bound* the board: `ranking_config` remains what the board
//! shows (the operator's decision for this surface). This row is the routing fact — which contest
//! this instance serves — so a board may not draw a contest the row does not name, and the two
//! disagreeing is a refusal rather than a silent pick between them.

use std::time::Duration;

use sqlx::postgres::PgPool;
use tokio::sync::Mutex;
use tokio::time::Instant;

/// The role the registry files this service under. It is the same spelling the panel's role menu
/// offers, and the same one a row is read back by.
pub const SERVICE_ROLE: &str = "RankingWebServer";

/// How long one resolved row is trusted before it is read again.
///
/// WHY the same five seconds the other services use: the row is the hot lever, so the worst case an
/// operator sees after a re-point is one TTL — short enough to read as immediate, long enough that
/// a board under load is not one registry query per request.
pub const BINDING_MAX_AGE: Duration = Duration::from_secs(5);

/// The contest this instance serves, as the registry states it.
///
/// WHY "no row" and "a row naming no contest" are one value: both mean the registry does not name a
/// single contest for this instance, which is the multicontest mode a deployment with no registry
/// run at all. They are one behaviour, so they are not two variants.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum ServedContest {
    /// No enabled row names this instance, or its row names no contest.
    #[default]
    EveryContest,
    /// An enabled row names exactly this contest.
    Contest(i32),
}

/// The registry's answer for this instance right now.
///
/// WHY a missing `services` table is not an error: the table belongs to the panel's migrations, and
/// a database that has not had them applied is a deployment with no registry at all — the same
/// answer as an empty one, never a board that cannot render because a table it does not own is
/// absent. The check is `to_regclass`, in the same statement, so there is no window between asking
/// and reading in which the table could appear.
pub async fn load_served_contest(pool: &PgPool, shard: u32) -> Result<ServedContest, sqlx::Error> {
    let row = sqlx::query_scalar::<_, Option<i32>>(
        "SELECT CASE WHEN to_regclass('public.services') IS NULL THEN NULL ELSE (\
         SELECT contest_id FROM services \
         WHERE role = $1 AND shard = $2 AND enabled ORDER BY id LIMIT 1) END",
    )
    .bind(SERVICE_ROLE)
    .bind(i32::try_from(shard).unwrap_or(i32::MAX))
    .fetch_one(pool)
    .await?;
    Ok(match row {
        Some(contest_id) => ServedContest::Contest(contest_id),
        None => ServedContest::EveryContest,
    })
}

struct Cached {
    served: ServedContest,
    read_at: Instant,
}

/// Holds the last resolved row so a burst of requests pays one query, and drops it once it is older
/// than [`BINDING_MAX_AGE`].
#[derive(Clone, Default)]
pub struct BindingCache {
    inner: std::sync::Arc<Mutex<Option<Cached>>>,
}

impl BindingCache {
    /// The served contest, read at most once per [`BINDING_MAX_AGE`].
    ///
    /// WHY the TTL is checked here and not with a timer: a timer would be a second thing to keep
    /// alive (and a second thing to leak), while the read that finds the entry stale is exactly the
    /// moment a fresh answer is needed.
    pub async fn served_contest(
        &self,
        shard: u32,
        pool: &PgPool,
    ) -> Result<ServedContest, sqlx::Error> {
        let mut guard = self.inner.lock().await;
        if let Some(cached) = guard.as_ref() {
            if cached.read_at.elapsed() < BINDING_MAX_AGE {
                return Ok(cached.served);
            }
        }
        let served = load_served_contest(pool, shard).await?;
        *guard = Some(Cached {
            served,
            read_at: Instant::now(),
        });
        Ok(served)
    }

    /// Drops the cached row, so the next read asks again. The tests use it to stand at a boundary
    /// without sleeping; nothing in the running service calls it.
    pub async fn forget(&self) {
        *self.inner.lock().await = None;
    }
}
