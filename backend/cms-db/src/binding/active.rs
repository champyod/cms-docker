//! The deployment default: `contests.is_active`, and the bootstrap before it exists.
//!
//! The database is the single source of what a stack serves. The one fallback is
//! the environment, and only while `contests` has not been created yet: before
//! `cmsInitDB` there is nothing to read. Every other state is fatal, so a running
//! stack never serves a contest the database does not name.

use std::env;

use sqlx::postgres::PgConnection;

use super::table_exists;
use super::BindingError;

/// The environment variable a fresh install names its contest in.
///
/// WHY the environment and not `config.toml`: compose still exports it, and a
/// service may not read the file the generator derives from the database.
pub const CONTEST_ID_ENV: &str = "CONTEST_ID";

/// Whether the deployment default exists, asked of the catalogue first.
const CONTESTS_EXIST: &str = "SELECT to_regclass('contests') IS NOT NULL";

/// The contest `contests.is_active` names, lowest id first.
pub const ACTIVE_CONTEST: &str = "SELECT id FROM contests WHERE is_active ORDER BY id LIMIT 1";

/// The active contest id, or `None` when the flag names no contest.
///
/// Lowest id wins — the order the admin panel and config sync use — so a
/// database that ever holds two active rows still hands every caller one contest.
///
/// # Errors
///
/// [`BindingError::MissingContests`] when the table does not exist yet. A
/// database that cannot be reached is not answered: its error propagates, so a
/// running stack fails loud instead of serving a contest nothing named.
pub async fn active_contest_id(connection: &mut PgConnection) -> Result<Option<i32>, BindingError> {
    if !table_exists(connection, CONTESTS_EXIST).await? {
        return Err(BindingError::MissingContests);
    }
    Ok(sqlx::query_scalar(ACTIVE_CONTEST)
        .fetch_optional(&mut *connection)
        .await?)
}

/// The contest a fresh install serves, read from `CONTEST_ID`.
///
/// An empty variable counts as unset, as the reference's truth test did.
///
/// # Errors
///
/// [`BindingError::BootstrapUnset`] when the variable is absent or empty, and
/// [`BindingError::BootstrapNotAContest`] when it holds anything else than an id.
pub fn bootstrap_contest_id() -> Result<i32, BindingError> {
    let value = env::var(CONTEST_ID_ENV)
        .ok()
        .filter(|value| !value.is_empty());
    let Some(value) = value else {
        return Err(BindingError::BootstrapUnset);
    };
    value
        .parse()
        .map_err(|_| BindingError::BootstrapNotAContest(value))
}

/// The contest a service serves: the active one, or the bootstrap on a fresh install.
///
/// # Errors
///
/// [`BindingError::NoActiveContest`] when the table exists and no row is active —
/// a different state from a missing table, and one the bootstrap must not answer.
pub async fn active_contest(connection: &mut PgConnection) -> Result<i32, BindingError> {
    match active_contest_id(&mut *connection).await {
        Ok(Some(contest_id)) => Ok(contest_id),
        Ok(None) => Err(BindingError::NoActiveContest),
        Err(BindingError::MissingContests) => bootstrap_contest_id(),
        Err(error) => Err(error),
    }
}
