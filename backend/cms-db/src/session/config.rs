//! The engine's settings, and the two flags this port refuses.
//!
//! The pool carries the reference's tuning: SQLAlchemy waits 60 seconds for a
//! connection, recycles one after 120, and allows its five pooled connections plus
//! ten of overflow. `[database] twophase_commit` and `[database] debug` are
//! settings an operator can turn on, so they are refused by name rather than
//! accepted and ignored. See [`UnhonouredOption`].
//!
//! The URL's `sslmode`, when it sets one, is honoured and none is added, because
//! the reference hands the same URL to libpq.

use std::str::FromStr;
use std::time::Duration;

use sqlx::postgres::{PgConnectOptions, PgPoolOptions};

use crate::actor::{self, ActorError};

/// SQLAlchemy's `pool_timeout`: how long a caller waits for a connection.
const ACQUIRE_TIMEOUT: Duration = Duration::from_secs(60);

/// SQLAlchemy's `pool_recycle`: how old a pooled connection may get before it is replaced.
const RECYCLE_AFTER: Duration = Duration::from_secs(120);

/// SQLAlchemy's default `pool_size`.
const POOL_SIZE: u32 = 5;

/// SQLAlchemy's default `max_overflow`; the pool allows the sum.
const MAX_OVERFLOW: u32 = 10;

/// The engine's settings, as `[database]` spells them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionConfig {
    /// `database.url`, including the SQLAlchemy driver suffix the reference writes.
    pub url: String,
    /// `database.debug`, SQLAlchemy's `echo`.
    pub debug: bool,
    /// `database.twophase_commit`, the flag `sessionmaker(twophase=...)` took.
    pub twophase_commit: bool,
}

impl SessionConfig {
    /// A configuration with both flags at their reference defaults.
    #[must_use]
    pub fn new(url: impl Into<String>) -> Self {
        Self {
            url: url.into(),
            debug: false,
            twophase_commit: false,
        }
    }

    /// Refuse a flag this port cannot honour, before a connection is attempted.
    pub fn check(&self) -> Result<(), SessionError> {
        let refused = [
            (self.twophase_commit, UnhonouredOption::TwoPhaseCommit),
            (self.debug, UnhonouredOption::StatementEcho),
        ]
        .into_iter()
        .find_map(|(is_set, option)| is_set.then_some(option));
        refused.map_or(Ok(()), |option| Err(SessionError::Unhonoured(option)))
    }

    /// The connection options the URL describes, carrying this program's label.
    ///
    /// WHY the label: `application_name` is where PostgreSQL records the program name the reference logged; it is not part of the authorization key.
    pub fn connect_options(&self) -> Result<PgConnectOptions, SessionError> {
        let url = libpq_url(&self.url)?;
        let options = PgConnectOptions::from_str(&url)
            .map_err(|error| SessionError::Url(self.url.clone(), error.to_string()))?;
        Ok(options.application_name(&actor::process_label()))
    }
}

/// A configured option this port cannot honour.
///
/// WHY an error and not a comment: a setting accepted but inert is worse than one that refuses, because the operator believes it is in force.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnhonouredOption {
    /// `database.twophase_commit`.
    TwoPhaseCommit,
    /// `database.debug`.
    StatementEcho,
}

impl UnhonouredOption {
    /// The configuration key as an operator writes it.
    #[must_use]
    pub const fn flag(self) -> &'static str {
        match self {
            Self::TwoPhaseCommit => "database.twophase_commit",
            Self::StatementEcho => "database.debug",
        }
    }

    /// Why it cannot be honoured here.
    #[must_use]
    pub const fn reason(self) -> &'static str {
        match self {
            Self::TwoPhaseCommit => {
                "sqlx exposes no two-phase commit (no PREPARE TRANSACTION), and no call site in \
                 this tree ever began one, so the flag selected no behaviour to reproduce"
            }
            Self::StatementEcho => {
                "sqlx logs statements through the `log` crate, which this crate does not depend \
                 on, and adding it to print SQL is not worth a new dependency"
            }
        }
    }
}

/// What went wrong opening or using a session.
#[derive(Debug, thiserror::Error)]
pub enum SessionError {
    /// The process identity is not one the policies can read.
    #[error(transparent)]
    Actor(#[from] ActorError),
    /// A configured option this port cannot honour.
    #[error("{} cannot be honoured: {}", .0.flag(), .0.reason())]
    Unhonoured(UnhonouredOption),
    /// The URL is not one libpq can read.
    #[error("{0} is not a usable database URL: {1}")]
    Url(String, String),
    /// The driver refused the connection or a statement.
    #[error(transparent)]
    Database(#[from] sqlx::Error),
}

/// The reference's pool tuning, in this driver's terms.
pub(super) fn pool_options() -> PgPoolOptions {
    PgPoolOptions::new()
        .max_connections(POOL_SIZE + MAX_OVERFLOW)
        .acquire_timeout(ACQUIRE_TIMEOUT)
        .max_lifetime(RECYCLE_AFTER)
}

/// The URL with its SQLAlchemy driver component removed.
///
/// WHY: `postgresql+psycopg2://` names psycopg2, a driver this port does not have, and the rest is libpq's own spelling, so only the component is dropped.
fn libpq_url(url: &str) -> Result<String, SessionError> {
    let (scheme, rest) = url
        .split_once("://")
        .ok_or_else(|| SessionError::Url(url.to_owned(), "no scheme".to_owned()))?;
    let scheme = scheme
        .split_once('+')
        .map_or(scheme, |(base, _driver)| base);
    if !matches!(scheme, "postgres" | "postgresql") {
        return Err(SessionError::Url(
            url.to_owned(),
            format!("{scheme} is not a PostgreSQL scheme"),
        ));
    }
    Ok(format!("{scheme}://{rest}"))
}
