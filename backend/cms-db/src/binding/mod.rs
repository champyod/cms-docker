//! Which contest a running service instance serves.
//!
//! `src/cms/db/util.py` answers that in three layers: the deployment default
//! (`contests.is_active`), the registry row written for one instance
//! (`services.contest_id`), and an explicit `-c` override, resolved in that
//! order. `registry` holds the row and `active` the default with its bootstrap.
//!
//! Two of `util.py`'s inhabitants stay out. `ask_for_contest` and
//! `ask_for_active_contest` print a numbered menu and call `input()`; a database
//! crate has no terminal and nothing in this tree could answer one, so only the
//! resolution they hand to the caller is ported. The prompting belongs to the CLI
//! crate that asks it — `cmscontrib`'s add/remove tools and `cmscontest` — which
//! lists the contests and passes the chosen id as an override.
//!
//! `test_db_connection` stays out for the same reason: it existed to turn an
//! unreachable database into a `ConfigError` once at start-up, and
//! [`Session::open`](crate::Session::open) connects eagerly and returns that
//! refusal as its own error, so a separate probe would only repeat it.
//!
//! The reference caches both answers for five seconds
//! (`REGISTRY_CONTEST_TTL_SECONDS`). The cache stays with the request layer that
//! owns the rows' lifetime, as it does for `grants`: every read here is the
//! database's current answer, and a caller that wants a TTL holds its own.

use sqlx::postgres::PgConnection;

mod active;
mod registry;

pub use active::{
    active_contest, active_contest_id, bootstrap_contest_id, ACTIVE_CONTEST, CONTEST_ID_ENV,
};
pub use registry::{service_binding, ServiceBinding, SERVICE, SERVICE_BINDING};

/// Why an instance's contest could not be resolved.
///
/// Every variant is a state the reference answered by exiting the process. A
/// library does not exit, so each is returned and the binary decides the status.
#[derive(Debug, thiserror::Error)]
pub enum BindingError {
    /// A read the server refused.
    #[error("resolving the contest binding failed: {0}")]
    Database(#[from] sqlx::Error),
    /// `contests` does not exist yet, so there is no deployment default to read.
    #[error("the contests table does not exist yet")]
    MissingContests,
    /// `contests` exists and holds no active row, which is not bootstrappable.
    #[error(
        "no active contest: contests.is_active holds no active row; \
         set one with './cms contest set-active <id>'"
    )]
    NoActiveContest,
    /// A fresh install that names no contest in `CONTEST_ID`.
    #[error(
        "contests does not exist yet and CONTEST_ID is unset: \
         cannot decide which contest to serve"
    )]
    BootstrapUnset,
    /// `CONTEST_ID` set to something that is not a contest id.
    #[error("bootstrap CONTEST_ID '{0}' is not a contest id")]
    BootstrapNotAContest(String),
}

/// One catalogue question, so both reads ask it the same way.
async fn table_exists(
    connection: &mut PgConnection,
    statement: &'static str,
) -> Result<bool, BindingError> {
    Ok(sqlx::query_scalar(statement)
        .fetch_one(&mut *connection)
        .await?)
}
