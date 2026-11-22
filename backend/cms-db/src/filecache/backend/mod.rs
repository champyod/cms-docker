//! The three storages a cache can sit in front of: nothing, a directory, the database.
//!
//! The reference declared these as an abstract base class and three subclasses.
//! Async methods are not object-safe without boxing every future, and the set of
//! backends is closed — a fourth would be a change here, not somewhere else — so
//! the dispatch is an enum. The consequence is deliberate: a writer carries the
//! backend that made it, and committing it to another one is refused rather than
//! silently misplaced.

mod database;
mod filesystem;
mod null;

pub use database::DbBackend;
pub use filesystem::FsBackend;
pub use null::NullBackend;

use std::path::PathBuf;

use crate::digest::FileDigest;
use crate::session::SessionConfig;

use super::store::{Readable, Writable};
use super::FileCacheError;

/// One file a backend reports it holds.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredFile {
    /// The digest the file is stored under.
    pub digest: FileDigest,
    /// Its description, when the backend keeps one.
    pub description: Option<String>,
}

/// Where a cache stores what it holds.
pub enum Backend {
    /// Nothing: every file offered is dropped and every file asked for is missing.
    Null(NullBackend),
    /// A directory named after each digest.
    FileSystem(FsBackend),
    /// The `fsobjects` table and the large objects its rows point at.
    Database(DbBackend),
}

impl Backend {
    /// The backend that stores nothing.
    ///
    /// The reference used it for short-lived local work that relied on the cache
    /// alone, which is why a file put through it still lands in the cache.
    #[must_use]
    pub const fn null() -> Self {
        Self::Null(NullBackend)
    }

    /// A backend rooted at `path`, created when it does not exist.
    ///
    /// # Errors
    ///
    /// [`FileCacheError::Directory`] when the directory cannot be created.
    pub fn file_system(path: impl Into<PathBuf>) -> Result<Self, FileCacheError> {
        Ok(Self::FileSystem(FsBackend::new(path)?))
    }

    /// The database backend, on the connection settings of `config`.
    #[must_use]
    pub const fn database(config: SessionConfig) -> Self {
        Self::Database(DbBackend::new(config))
    }

    /// Retrieve a file, or [`FileCacheError::Missing`].
    ///
    /// # Errors
    ///
    /// Whatever the backend reports.
    pub async fn get_file(&self, digest: &FileDigest) -> Result<Readable, FileCacheError> {
        match self {
            Self::Null(backend) => backend.get_file(digest).await,
            Self::FileSystem(backend) => backend.get_file(digest).await,
            Self::Database(backend) => backend.get_file(digest).await,
        }
    }

    /// Open an empty writer for a file the backend does not hold yet.
    ///
    /// # Errors
    ///
    /// Whatever the backend reports.
    pub async fn create_file(
        &self,
        digest: &FileDigest,
    ) -> Result<Option<Writable>, FileCacheError> {
        match self {
            Self::Null(backend) => backend.create_file(digest).await,
            Self::FileSystem(backend) => backend.create_file(digest).await,
            Self::Database(backend) => backend.create_file(digest).await,
        }
    }

    /// Commit a writer, answering whether this call is what stored the file.
    ///
    /// `false` means another writer stored the same digest first, which the
    /// reference returned for testing purposes only and left every caller free to
    /// ignore.
    ///
    /// # Errors
    ///
    /// [`FileCacheError::ForeignWriter`] when the writer came from another backend,
    /// and whatever the backend reports.
    pub async fn commit(
        &self,
        writer: Writable,
        digest: &FileDigest,
        description: &str,
    ) -> Result<bool, FileCacheError> {
        match self {
            Self::Null(backend) => backend.commit(writer, digest, description).await,
            Self::FileSystem(backend) => backend.commit(writer, digest, description).await,
            Self::Database(backend) => backend.commit(writer, digest, description).await,
        }
    }

    /// A file's description.
    ///
    /// # Errors
    ///
    /// [`FileCacheError::Missing`] when the backend holds no such file.
    pub async fn describe(&self, digest: &FileDigest) -> Result<Option<String>, FileCacheError> {
        match self {
            Self::Null(backend) => backend.describe(digest).await,
            Self::FileSystem(backend) => backend.describe(digest).await,
            Self::Database(backend) => backend.describe(digest).await,
        }
    }

    /// A file's size in bytes.
    ///
    /// # Errors
    ///
    /// [`FileCacheError::Missing`] when the backend holds no such file.
    pub async fn get_size(&self, digest: &FileDigest) -> Result<u64, FileCacheError> {
        match self {
            Self::Null(backend) => backend.get_size(digest).await,
            Self::FileSystem(backend) => backend.get_size(digest).await,
            Self::Database(backend) => backend.get_size(digest).await,
        }
    }

    /// Remove a file.
    ///
    /// # Errors
    ///
    /// Whatever the backend reports; a file that is already gone is not a failure.
    pub async fn delete(&self, digest: &FileDigest) -> Result<(), FileCacheError> {
        match self {
            Self::Null(backend) => backend.delete(digest).await,
            Self::FileSystem(backend) => backend.delete(digest).await,
            Self::Database(backend) => backend.delete(digest).await,
        }
    }

    /// Every file the backend holds.
    ///
    /// # Errors
    ///
    /// Whatever the backend reports.
    pub async fn list(&self) -> Result<Vec<StoredFile>, FileCacheError> {
        match self {
            Self::Null(backend) => backend.list().await,
            Self::FileSystem(backend) => backend.list().await,
            Self::Database(backend) => backend.list().await,
        }
    }
}
