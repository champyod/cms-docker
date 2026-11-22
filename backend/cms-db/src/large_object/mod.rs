//! A PostgreSQL large object as a byte stream.
//!
//! The reference reached the server's large-object API through psycopg2's SQL
//! functions rather than the driver's own `lobject` wrapper, because that wrapper
//! cannot run on a cooperative connection. sqlx has no large-object support at
//! all, so the functions are not a workaround here but the mechanism: `lo_create`,
//! `lo_open`, `loread`, `lowrite`, `lo_lseek`, `lo_tell`, `lo_truncate`,
//! `lo_close` and `lo_unlink` are ordinary statements, and PostgreSQL 16 still
//! carries every one of them.
//!
//! Two properties of that API decide the shape of this type:
//!
//! - the descriptor `lo_open` returns lives in the transaction that opened it, so
//!   the constructor issues `BEGIN` and [`LargeObject::close`] commits. One
//!   transaction spans the object's life, which is the window psycopg2 held
//!   implicitly; per-statement autocommit would lose the descriptor after the
//!   first read and publish a half-written object;
//! - a transaction that long cannot sit on a pooled connection, so the object owns
//!   a [`DedicatedConnection`], as the reference's own connection did.
//!
//! Dropping the object without [`close`](LargeObject::close) rolls the transaction
//! back, which is what closing a psycopg2 connection did with an open one: the
//! bytes never become visible. A writer therefore has to close to commit, and
//! nothing here commits on its behalf.
//!
//! The reference's `mode` string was validated for the characters `r`, `w` and `b`
//! and for the mandatory `b`. [`Mode`] states the three combinations that survived
//! validation, and `b` is not one of them: a Rust stream carries bytes, so there is
//! no text mode to refuse.

use sqlx::postgres::types::Oid;
use sqlx::postgres::PgConnection;

use crate::session::{DedicatedConnection, SessionConfig};

mod error;
mod mode;
mod stream;

pub use error::LargeObjectError;
pub use mode::Mode;

/// `lo_create(0)` asks for a free oid, and the parameter is cast because the
/// function takes `oid` where a bare `0` would bind as `integer`.
const CREATE_SQL: &str = "SELECT lo_create($1::oid)";
const OPEN_SQL: &str = "SELECT lo_open($1::oid, $2)";
const CLOSE_SQL: &str = "SELECT lo_close($1)";
const UNLINK_SQL: &str = "SELECT lo_unlink($1::oid)";
const BEGIN_SQL: &str = "BEGIN";
const COMMIT_SQL: &str = "COMMIT";

/// A large object, open, on its own connection.
pub struct LargeObject {
    connection: DedicatedConnection,
    loid: u32,
    descriptor: Option<i32>,
    mode: Mode,
}

impl LargeObject {
    /// Create an object that holds nothing yet, and open it.
    ///
    /// The reference spelled this as `loid = 0`; a separate constructor says it
    /// without a sentinel that a caller could pass by accident.
    ///
    /// # Errors
    ///
    /// [`LargeObjectError::Session`] when the connection cannot be opened,
    /// [`LargeObjectError::Create`] when the server refuses the creation,
    /// [`LargeObjectError::Open`] when it refuses the descriptor.
    pub async fn create(config: &SessionConfig, mode: Mode) -> Result<Self, LargeObjectError> {
        let mut connection = begin(config).await?;
        let loid: Oid = sqlx::query_scalar(CREATE_SQL)
            .bind(Oid(0))
            .fetch_one(connection.connection())
            .await
            .map_err(|source| LargeObjectError::Create { source })?;
        let loid = loid.0;
        Self::open_on(connection, loid, mode).await
    }

    /// Open an object that already exists.
    ///
    /// # Errors
    ///
    /// [`LargeObjectError::Session`] when the connection cannot be opened, and
    /// [`LargeObjectError::Open`] when the server refuses the descriptor, which is
    /// also what an oid that names no object gets.
    pub async fn open(
        config: &SessionConfig,
        loid: u32,
        mode: Mode,
    ) -> Result<Self, LargeObjectError> {
        let connection = begin(config).await?;
        Self::open_on(connection, loid, mode).await
    }

    async fn open_on(
        mut connection: DedicatedConnection,
        loid: u32,
        mode: Mode,
    ) -> Result<Self, LargeObjectError> {
        let descriptor: i32 = sqlx::query_scalar(OPEN_SQL)
            .bind(Oid(loid))
            .bind(mode.bits())
            .fetch_one(connection.connection())
            .await
            .map_err(|source| LargeObjectError::Open { loid, source })?;
        Ok(Self {
            connection,
            loid,
            descriptor: Some(descriptor),
            mode,
        })
    }

    /// The object's oid, which is what an `fsobjects` row records.
    #[must_use]
    pub const fn loid(&self) -> u32 {
        self.loid
    }

    /// How the object was opened.
    #[must_use]
    pub const fn mode(&self) -> Mode {
        self.mode
    }

    /// Whether [`close`](Self::close) has run.
    #[must_use]
    pub const fn is_closed(&self) -> bool {
        self.descriptor.is_none()
    }

    /// The connection the object's statements run on.
    pub fn connection(&mut self) -> &mut PgConnection {
        self.connection.connection()
    }

    /// Close the descriptor and commit, making the bytes visible.
    ///
    /// The commit is attempted even when `lo_close` is refused: the descriptor dies
    /// with the transaction either way, and an aborted transaction's `COMMIT` is
    /// the server's rollback, so the failure reported is the one that caused it.
    ///
    /// # Errors
    ///
    /// [`LargeObjectError::Close`] when the server refuses the close or the commit.
    pub async fn close(mut self) -> Result<(), LargeObjectError> {
        let Some(descriptor) = self.descriptor.take() else {
            return Ok(());
        };
        let loid = self.loid;
        let closed = sqlx::query(CLOSE_SQL)
            .bind(descriptor)
            .execute(self.connection.connection())
            .await;
        let committed = sqlx::query(COMMIT_SQL)
            .execute(self.connection.connection())
            .await;
        closed.map_err(|source| LargeObjectError::Close { loid, source })?;
        committed.map_err(|source| LargeObjectError::Close { loid, source })?;
        Ok(())
    }

    /// Destroy an object on its own connection, as `LargeObject.unlink` did.
    ///
    /// # Errors
    ///
    /// [`LargeObjectError::Session`] when the connection cannot be opened, and
    /// [`LargeObjectError::Unlink`] when the server refuses the statement.
    pub async fn unlink(config: &SessionConfig, loid: u32) -> Result<(), LargeObjectError> {
        let mut connection = DedicatedConnection::open(config).await?;
        Self::unlink_on(connection.connection(), loid).await
    }

    /// Destroy an object on a connection the caller already holds.
    ///
    /// The statement is transactional here, unlike [`unlink`](Self::unlink), so a
    /// caller emptying a table can unlink and delete in one commit.
    ///
    /// # Errors
    ///
    /// [`LargeObjectError::Unlink`] when the server refuses the statement.
    pub async fn unlink_on(
        connection: &mut PgConnection,
        loid: u32,
    ) -> Result<(), LargeObjectError> {
        sqlx::query(UNLINK_SQL)
            .bind(Oid(loid))
            .execute(connection)
            .await
            .map_err(|source| LargeObjectError::Unlink { loid, source })?;
        Ok(())
    }
}

/// Open the connection and the transaction the descriptor will live in.
async fn begin(config: &SessionConfig) -> Result<DedicatedConnection, LargeObjectError> {
    let mut connection = DedicatedConnection::open(config).await?;
    sqlx::query(BEGIN_SQL)
        .execute(connection.connection())
        .await
        .map_err(|source| LargeObjectError::Create { source })?;
    Ok(connection)
}
