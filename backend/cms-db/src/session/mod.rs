//! The session, and the identity every transaction carries.
//!
//! Every transaction a session starts is stamped with the process's database
//! actor, and that stamp lives where a transaction begins rather than where a
//! session is opened. The distinction is load-bearing: a session may commit and
//! keep working, and every statement after that commit runs in a NEW transaction
//! with the transaction-local GUC already reset, so a hint applied once at
//! `open` would leave the later half of a long-lived session unidentified —
//! silently, and only on the paths that commit mid-way.
//!
//! [`Session::begin`] is therefore the only way to obtain a [`Transaction`], and
//! it stamps before handing it over; [`Transaction::commit`] consumes it, so
//! continuing requires another `begin`, which stamps again. A stamp once per
//! session or once per connection has no expression here to get wrong.
//!
//! The engine's settings, the pool tuning and the two flags this port refuses are
//! in `config`.

use sqlx::postgres::PgConnection;
use sqlx::{Connection, Postgres, Transaction as SqlxTransaction};

use crate::actor;

mod config;

use config::pool_options;
pub use config::{SessionConfig, SessionError, UnhonouredOption};

/// A pooled session: the only way to start a transaction, and it stamps it.
pub struct Session {
    pool: sqlx::PgPool,
    actor: String,
}

impl Session {
    /// Open the pool and fix the identity for this session's life.
    ///
    /// WHY read once: it is the process's, so no call site and no later environment change can move it mid-run.
    pub async fn open(config: &SessionConfig) -> Result<Self, SessionError> {
        config.check()?;
        let actor = actor::default_actor()?;
        let pool = pool_options()
            .connect_with(config.connect_options()?)
            .await?;
        Ok(Self { pool, actor })
    }

    /// The identity every transaction of this session is stamped with.
    #[must_use]
    pub fn actor(&self) -> &str {
        &self.actor
    }

    /// Begin a transaction, stamped before the caller can use it.
    pub async fn begin(&self) -> Result<Transaction, SessionError> {
        let mut transaction = self.pool.begin().await?;
        sqlx::query(actor::TRANSACTION_STAMP_SQL)
            .bind(&self.actor)
            .execute(&mut *transaction)
            .await?;
        Ok(Transaction { inner: transaction })
    }
}

/// A transaction that was stamped when it began.
pub struct Transaction {
    inner: SqlxTransaction<'static, Postgres>,
}

impl Transaction {
    /// The connection queries run on.
    pub fn connection(&mut self) -> &mut PgConnection {
        &mut self.inner
    }

    /// Commit; continuing needs a new [`Session::begin`], which stamps again.
    pub async fn commit(self) -> Result<(), sqlx::Error> {
        self.inner.commit().await
    }

    /// Roll back; dropping without a commit does the same.
    pub async fn rollback(self) -> Result<(), sqlx::Error> {
        self.inner.rollback().await
    }
}

/// A connection outside the pool, stamped for its lifetime and closed by its owner.
pub struct DedicatedConnection {
    connection: PgConnection,
    username: String,
}

impl DedicatedConnection {
    /// Open the connection the pool will never see, and stamp it at session scope.
    ///
    /// WHY session scope here: large-object traffic on this connection commits mid-stream, where a transaction-local stamp is lost.
    pub async fn open(config: &SessionConfig) -> Result<Self, SessionError> {
        config.check()?;
        let actor = actor::default_actor()?;
        let options = config.connect_options()?;
        let username = options.get_username().to_owned();
        let mut connection = PgConnection::connect_with(&options).await?;
        sqlx::query(actor::CONNECTION_STAMP_SQL)
            .bind(&actor)
            .execute(&mut connection)
            .await?;
        Ok(Self {
            connection,
            username,
        })
    }

    /// The connection itself.
    pub fn connection(&mut self) -> &mut PgConnection {
        &mut self.connection
    }

    /// The role the connection authenticated as, for a privilege message.
    #[must_use]
    pub fn username(&self) -> &str {
        &self.username
    }
}
