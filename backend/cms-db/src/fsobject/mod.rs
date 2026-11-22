//! One `fsobjects` row: the three columns, and the large object it points at.
//!
//! A row is a claim that a large object holding a given digest's bytes exists, so
//! every operation is either the row or the bytes: the digest is the key the cache
//! looks a file up by and the oid joins it to the storage. Nothing in the schema
//! references `digest`, which is why [`delete`](FSObject::delete) removes both and
//! nothing else has to be told.

use sqlx::postgres::types::Oid;
use sqlx::postgres::PgConnection;
use sqlx::Row;

use crate::base::{Column, ColumnKind, Declaration};
use crate::digest::FileDigest;
use crate::large_object::{LargeObject, Mode};
use crate::session::SessionConfig;

mod error;

pub use error::FsObjectError;

/// The `loid` a row carries when no large object was ever attached, the column's
/// own default.
pub const NO_LARGE_OBJECT: u32 = 0;

/// The three columns, bound to the digest as `$1`.
///
/// WHY the casts: `digest` is the `DIGEST` domain, a type of its own, and the
/// driver binds and reads text only as `varchar`; without the cast every statement
/// here would be refused for a type the driver does not know.
pub const FSOBJECT_BY_DIGEST: &str = "\
    SELECT digest::text AS digest, loid, description FROM fsobjects \
    WHERE digest = $1::varchar";

/// Every row, in no order, which is what `get_all` returned.
pub const FSOBJECTS: &str = "SELECT digest::text AS digest, loid, description FROM fsobjects";

/// The row one stored file writes.
pub const INSERT_FSOBJECT: &str =
    "INSERT INTO fsobjects (digest, loid, description) VALUES ($1::varchar, $2::oid, $3)";

/// The row one stored file removes.
pub const DELETE_FSOBJECT: &str = "DELETE FROM fsobjects WHERE digest = $1::varchar";

/// Every row, which is the second half of `delete_all`.
pub const DELETE_FSOBJECTS: &str = "DELETE FROM fsobjects";

/// What `fsobjects` is, as the model contract declares it.
///
/// `loid` is `oid` rather than an integer because that is the column's type, and
/// `digest` is the primary key rather than a surrogate id because the digest is the
/// only name a stored file has.
pub const FSOBJECT_DECLARATION: Declaration = Declaration {
    table: "fsobjects",
    columns: &[
        Column {
            name: "digest",
            kind: ColumnKind::Digest,
            nullable: false,
            has_default: false,
            primary_key: true,
            foreign_key: false,
        },
        Column {
            name: "loid",
            kind: ColumnKind::Oid,
            nullable: false,
            has_default: true,
            primary_key: false,
            foreign_key: false,
        },
        Column {
            name: "description",
            kind: ColumnKind::Text,
            nullable: true,
            has_default: false,
            primary_key: false,
            foreign_key: false,
        },
    ],
    relationships: &[],
};

/// One stored file: its digest, the large object holding the bytes, its label.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FSObject {
    /// The SHA-1 of the content, and the primary key.
    pub digest: FileDigest,
    /// The large object holding the content.
    pub loid: u32,
    /// A label meant for humans, carrying no meaning of its own.
    pub description: Option<String>,
}

impl FSObject {
    /// The row whose digest is `digest`, or `None` when the store holds no such file.
    ///
    /// # Errors
    ///
    /// [`FsObjectError::Select`] when the server refuses the query, and
    /// [`FsObjectError::Digest`] for a column value the domain would have refused.
    pub async fn get(
        connection: &mut PgConnection,
        digest: &FileDigest,
    ) -> Result<Option<Self>, FsObjectError> {
        let row = sqlx::query(FSOBJECT_BY_DIGEST)
            .bind(digest.as_str())
            .fetch_optional(connection)
            .await
            .map_err(|source| FsObjectError::Select { source })?;
        row.as_ref().map(Self::from_row).transpose()
    }

    /// Every row, or none when the table does not exist yet.
    ///
    /// The reference asked `cls.__table__.exists()` first and returned an empty list
    /// for a database that never held a file; the server's own answer to the same
    /// question is `42P01`, so that one refusal is read as "no table" and every
    /// other is an error.
    ///
    /// # Errors
    ///
    /// [`FsObjectError::Select`] for a refusal other than the missing table, and
    /// [`FsObjectError::Digest`] for a column value the domain would have refused.
    pub async fn get_all(connection: &mut PgConnection) -> Result<Vec<Self>, FsObjectError> {
        match sqlx::query(FSOBJECTS).fetch_all(connection).await {
            Ok(rows) => rows.iter().map(Self::from_row).collect(),
            Err(error) if is_undefined_table(&error) => Ok(Vec::new()),
            Err(source) => Err(FsObjectError::Select { source }),
        }
    }

    /// Record this row, leaving the commit to the caller.
    ///
    /// # Errors
    ///
    /// [`FsObjectError::Insert`] when the server refuses the statement, which is
    /// what a digest already stored looks like: the caller has to tell that
    /// refusal apart from a real one, so it is not swallowed here.
    pub async fn insert(&self, connection: &mut PgConnection) -> Result<(), FsObjectError> {
        sqlx::query(INSERT_FSOBJECT)
            .bind(self.digest.as_str())
            .bind(Oid(self.loid))
            .bind(self.description.as_deref())
            .execute(connection)
            .await
            .map_err(|source| FsObjectError::Insert { source })?;
        Ok(())
    }

    /// Delete the bytes, then the row.
    ///
    /// The unlink runs on its own connection and commits on its own, as
    /// `LargeObject.unlink` did, so the bytes are gone even when the caller's
    /// transaction is later rolled back; the row removal stays in that transaction.
    ///
    /// # Errors
    ///
    /// [`FsObjectError::LargeObject`] when the unlink is refused and
    /// [`FsObjectError::Delete`] when the row removal is.
    pub async fn delete(
        &self,
        config: &SessionConfig,
        connection: &mut PgConnection,
    ) -> Result<(), FsObjectError> {
        LargeObject::unlink(config, self.loid).await?;
        Self::delete_row(connection, &self.digest).await
    }

    /// Delete every row and every large object the table links.
    ///
    /// One transaction, so the rows and the bytes disappear together: the
    /// reference unlinked per row on connections of its own and could leave a
    /// large object behind when the row deletion was rolled back. Large objects no
    /// row links were already invisible to it, and stay so.
    ///
    /// # Errors
    ///
    /// [`FsObjectError::Select`] when the rows cannot be read,
    /// [`FsObjectError::LargeObject`] when an unlink is refused, and
    /// [`FsObjectError::Delete`] when the rows cannot be removed.
    pub async fn delete_all(connection: &mut PgConnection) -> Result<(), FsObjectError> {
        let rows = Self::get_all(connection).await?;
        for row in &rows {
            LargeObject::unlink_on(connection, row.loid).await?;
        }
        sqlx::query(DELETE_FSOBJECTS)
            .execute(connection)
            .await
            .map_err(|source| FsObjectError::Delete { source })?;
        Ok(())
    }

    /// Open the large object this row names.
    ///
    /// # Errors
    ///
    /// [`FsObjectError::NoLargeObject`] when the row never got its bytes,
    /// [`FsObjectError::Session`] when the connection cannot be opened, and
    /// [`FsObjectError::LargeObject`] when the server refuses the descriptor.
    pub async fn open_large_object(
        &self,
        config: &SessionConfig,
        mode: Mode,
    ) -> Result<LargeObject, FsObjectError> {
        if self.loid == NO_LARGE_OBJECT {
            return Err(FsObjectError::NoLargeObject(self.digest.clone()));
        }
        Ok(LargeObject::open(config, self.loid, mode).await?)
    }

    async fn delete_row(
        connection: &mut PgConnection,
        digest: &FileDigest,
    ) -> Result<(), FsObjectError> {
        sqlx::query(DELETE_FSOBJECT)
            .bind(digest.as_str())
            .execute(connection)
            .await
            .map_err(|source| FsObjectError::Delete { source })?;
        Ok(())
    }

    fn from_row(row: &sqlx::postgres::PgRow) -> Result<Self, FsObjectError> {
        let digest: String = row
            .try_get("digest")
            .map_err(|source| FsObjectError::Select { source })?;
        let loid: Oid = row
            .try_get("loid")
            .map_err(|source| FsObjectError::Select { source })?;
        let description: Option<String> = row
            .try_get("description")
            .map_err(|source| FsObjectError::Select { source })?;
        Ok(Self {
            digest: digest
                .parse()
                .map_err(|source| FsObjectError::Digest { digest, source })?,
            loid: loid.0,
            description,
        })
    }
}

/// Whether the server refused because the table does not exist.
fn is_undefined_table(error: &sqlx::Error) -> bool {
    error
        .as_database_error()
        .and_then(|error| error.code())
        .is_some_and(|code| code.as_ref() == "42P01")
}
