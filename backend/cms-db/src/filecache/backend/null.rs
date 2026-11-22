//! The backend that stores nothing.
//!
//! It looks like `/dev/null`, as the reference put it, and it exists so a service
//! can rely on its local cache alone: `create_file` answers that there is nothing
//! to write, so a put stops after the cache and a get always misses.

use crate::digest::FileDigest;

use super::super::store::{Readable, Writable};
use super::super::FileCacheError;

/// A backend with no storage behind it.
#[derive(Debug, Clone, Copy, Default)]
pub struct NullBackend;

impl NullBackend {
    /// Nothing is ever stored, so nothing is found.
    ///
    /// # Errors
    ///
    /// Always [`FileCacheError::Missing`].
    pub async fn get_file(&self, digest: &FileDigest) -> Result<Readable, FileCacheError> {
        Err(FileCacheError::Missing(digest.clone()))
    }

    /// No writer, because there is nothing to write to.
    ///
    /// # Errors
    ///
    /// Nothing: a backend that stores nothing has nothing to refuse.
    pub async fn create_file(
        &self,
        _digest: &FileDigest,
    ) -> Result<Option<Writable>, FileCacheError> {
        Ok(None)
    }

    /// Nothing was stored, so this call did not store it.
    ///
    /// # Errors
    ///
    /// Nothing: the writer is dropped.
    pub async fn commit(
        &self,
        _writer: Writable,
        _digest: &FileDigest,
        _description: &str,
    ) -> Result<bool, FileCacheError> {
        Ok(false)
    }

    /// Nothing is ever stored, so nothing is described.
    ///
    /// # Errors
    ///
    /// Always [`FileCacheError::Missing`].
    pub async fn describe(&self, digest: &FileDigest) -> Result<Option<String>, FileCacheError> {
        Err(FileCacheError::Missing(digest.clone()))
    }

    /// Nothing is ever stored, so nothing has a size.
    ///
    /// # Errors
    ///
    /// Always [`FileCacheError::Missing`].
    pub async fn get_size(&self, digest: &FileDigest) -> Result<u64, FileCacheError> {
        Err(FileCacheError::Missing(digest.clone()))
    }

    /// There is nothing to remove, and removing it succeeds anyway.
    ///
    /// # Errors
    ///
    /// Nothing.
    pub async fn delete(&self, _digest: &FileDigest) -> Result<(), FileCacheError> {
        Ok(())
    }

    /// No files.
    ///
    /// # Errors
    ///
    /// Nothing.
    pub async fn list(&self) -> Result<Vec<super::StoredFile>, FileCacheError> {
        Ok(Vec::new())
    }
}
