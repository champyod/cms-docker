//! A backend that keeps the bytes in PostgreSQL, as large objects.
//!
//! Each operation opens the connection it needs, which is what `SessionGen()`
//! provided on the Python side: a row statement runs in a transaction of its own
//! and commits, and a large object runs on the dedicated connection that holds the
//! transaction its descriptor lives in. Nothing here is pooled, so a backend can
//! be built before any connection exists.

use std::io::SeekFrom;

use crate::digest::FileDigest;
use crate::fsobject::{FSObject, FsObjectError};
use crate::large_object::{LargeObject, Mode};
use crate::session::{DedicatedConnection, SessionConfig};

use super::super::store::{Readable, Writable};
use super::super::FileCacheError;
use super::StoredFile;

/// The `fsobjects` table and the large objects its rows point at.
pub struct DbBackend {
    config: SessionConfig,
}

impl DbBackend {
    /// A backend on `config`'s connection settings.
    #[must_use]
    pub const fn new(config: SessionConfig) -> Self {
        Self { config }
    }

    /// Open the file whose row carries `digest`.
    ///
    /// # Errors
    ///
    /// [`FileCacheError::Missing`] when the table holds no such row, and whatever
    /// the session or the large object reports.
    pub async fn get_file(&self, digest: &FileDigest) -> Result<Readable, FileCacheError> {
        let mut connection = self.connection().await?;
        let row = FSObject::get(connection.connection(), digest)
            .await?
            .ok_or_else(|| FileCacheError::Missing(digest.clone()))?;
        let object = row.open_large_object(&self.config, Mode::READ).await?;
        Ok(Readable::LargeObject(object))
    }

    /// Open a new large object when no row carries `digest` yet.
    ///
    /// # Errors
    ///
    /// Whatever the session or the large object reports.
    pub async fn create_file(
        &self,
        digest: &FileDigest,
    ) -> Result<Option<Writable>, FileCacheError> {
        let mut connection = self.connection().await?;
        if FSObject::get(connection.connection(), digest)
            .await?
            .is_some()
        {
            return Ok(None);
        }
        let object = LargeObject::create(&self.config, Mode::WRITE).await?;
        Ok(Some(Writable::LargeObject(object)))
    }

    /// Commit the bytes, then the row that makes them findable.
    ///
    /// The order is the reference's and it is load-bearing: the large object is
    /// closed — which commits its bytes — before the insert, so a row never names
    /// bytes that were not written, and a failed insert leaves an object to unlink
    /// rather than a row to repair.
    ///
    /// # Errors
    ///
    /// [`FileCacheError::ForeignWriter`] for a writer another backend made, and
    /// whatever the session, the large object or the insert reports.
    pub async fn commit(
        &self,
        writer: Writable,
        digest: &FileDigest,
        description: &str,
    ) -> Result<bool, FileCacheError> {
        let Writable::LargeObject(object) = writer else {
            return Err(FileCacheError::ForeignWriter);
        };
        let loid = object.loid();
        object.close().await?;

        let row = FSObject {
            digest: digest.clone(),
            loid,
            description: Some(description.to_owned()),
        };
        let mut connection = self.connection().await?;
        match row.insert(connection.connection()).await {
            Ok(()) => Ok(true),
            // A rival inserted the same digest since the check, so our bytes are unnamed.
            Err(FsObjectError::Insert { source }) if is_unique_violation(&source) => {
                LargeObject::unlink(&self.config, loid).await?;
                Ok(false)
            }
            Err(error) => Err(error.into()),
        }
    }

    /// The description the row holds.
    ///
    /// # Errors
    ///
    /// [`FileCacheError::Missing`] when the table holds no such row.
    pub async fn describe(&self, digest: &FileDigest) -> Result<Option<String>, FileCacheError> {
        let mut connection = self.connection().await?;
        let row = FSObject::get(connection.connection(), digest)
            .await?
            .ok_or_else(|| FileCacheError::Missing(digest.clone()))?;
        Ok(row.description)
    }

    /// The size of the object's content, measured by seeking to its end.
    ///
    /// There is no length column to read, so this is the reference's own way of
    /// measuring: open, seek past the content, report where that lands.
    ///
    /// # Errors
    ///
    /// [`FileCacheError::Missing`] when the table holds no such row, and whatever
    /// the large object reports.
    pub async fn get_size(&self, digest: &FileDigest) -> Result<u64, FileCacheError> {
        let mut connection = self.connection().await?;
        let row = FSObject::get(connection.connection(), digest)
            .await?
            .ok_or_else(|| FileCacheError::Missing(digest.clone()))?;
        let mut object = row.open_large_object(&self.config, Mode::READ).await?;
        let size = object.seek(SeekFrom::End(0)).await?;
        object.close().await?;
        Ok(size)
    }

    /// Remove the bytes and the row, treating an absent row as removed.
    ///
    /// # Errors
    ///
    /// Whatever the session, the large object or the row removal reports.
    pub async fn delete(&self, digest: &FileDigest) -> Result<(), FileCacheError> {
        let mut connection = self.connection().await?;
        let Some(row) = FSObject::get(connection.connection(), digest).await? else {
            return Ok(());
        };
        row.delete(&self.config, connection.connection()).await?;
        Ok(())
    }

    /// Every row, or none when the table does not exist yet.
    ///
    /// # Errors
    ///
    /// Whatever the session or the select reports.
    pub async fn list(&self) -> Result<Vec<StoredFile>, FileCacheError> {
        let mut connection = self.connection().await?;
        let rows = FSObject::get_all(connection.connection()).await?;
        Ok(rows
            .into_iter()
            .map(|row| StoredFile {
                digest: row.digest,
                description: row.description,
            })
            .collect())
    }

    async fn connection(&self) -> Result<DedicatedConnection, FileCacheError> {
        Ok(DedicatedConnection::open(&self.config).await?)
    }
}

/// Whether the server refused for a duplicate key, which is the only refusal here
/// that means another writer won rather than this one being wrong.
fn is_unique_violation(error: &sqlx::Error) -> bool {
    error
        .as_database_error()
        .and_then(|error| error.code())
        .is_some_and(|code| code.as_ref() == "23505")
}
