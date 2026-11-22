//! What a cache can say about a file without reading it, and how it lets go of one.
//!
//! Every method that takes a digest takes a [`CacheHandle`], so the tombstone is
//! refused where the reference returned early instead: `drop` and `delete` read the
//! handle's [`RemoveAction`] and do nothing for it, while `describe`, `get_size` and
//! the readers report it as the error it is.

use std::fs;

use crate::digest::{CacheHandle, Digester, FileDigest, RemoveAction};

use super::store::Readable;
use super::{
    create_directory, naming, remove_tree, FileCache, FileCacheError, StoredFile, CHUNK_SIZE,
    TEMPORARY_PREFIX,
};

impl FileCache {
    /// The description the backend holds.
    ///
    /// # Errors
    ///
    /// [`FileCacheError::Tombstone`] for the tombstone, and
    /// [`FileCacheError::Missing`] when the backend holds no such file.
    pub async fn describe(&self, handle: &CacheHandle) -> Result<Option<String>, FileCacheError> {
        self.backend.describe(handle.open()?).await
    }

    /// The file's size in bytes, as the backend measures it.
    ///
    /// # Errors
    ///
    /// [`FileCacheError::Tombstone`] for the tombstone, and
    /// [`FileCacheError::Missing`] when the backend holds no such file.
    pub async fn get_size(&self, handle: &CacheHandle) -> Result<u64, FileCacheError> {
        self.backend.get_size(handle.open()?).await
    }

    /// Every file the backend holds.
    ///
    /// # Errors
    ///
    /// Whatever the backend reports.
    pub async fn list(&self) -> Result<Vec<StoredFile>, FileCacheError> {
        self.backend.list().await
    }

    /// Delete a file from the cache only, keeping the backend's copy.
    ///
    /// # Errors
    ///
    /// [`FileCacheError::Io`] when the cached file cannot be removed for a reason
    /// other than being absent, which the reference's bare `except OSError` hid.
    pub fn drop_cached(&self, handle: &CacheHandle) -> Result<(), FileCacheError> {
        if handle.remove() == RemoveAction::Skipped {
            return Ok(());
        }
        let digest = handle.open()?;
        let path = self.cache_path(digest);
        match fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(source) => Err(FileCacheError::io(path, source)),
        }
    }

    /// Delete a file from the cache and from the backend.
    ///
    /// The cache goes first: a failed backend removal then leaves a file this
    /// machine can still serve, where the other order would leave a cache entry
    /// whose backend copy is already gone.
    ///
    /// # Errors
    ///
    /// Whatever [`drop_cached`](Self::drop_cached) or the backend reports.
    pub async fn delete(&self, handle: &CacheHandle) -> Result<(), FileCacheError> {
        if handle.remove() == RemoveAction::Skipped {
            return Ok(());
        }
        self.drop_cached(handle)?;
        self.backend.delete(handle.open()?).await
    }

    /// Empty the cache and leave it usable.
    ///
    /// # Errors
    ///
    /// [`FileCacheError::Shared`] for a shared cache, and
    /// [`FileCacheError::Io`] when a directory cannot be removed or recreated.
    pub fn purge(&mut self) -> Result<(), FileCacheError> {
        if self.is_shared() {
            return Err(FileCacheError::Shared);
        }
        remove_tree(self.file_dir())?;
        create_directory(self.file_dir())?;
        self.replace_temp_dir()
    }

    /// Remove the cache and everything this instance made, leaving it unusable.
    ///
    /// # Errors
    ///
    /// [`FileCacheError::Shared`] for a shared cache, and
    /// [`FileCacheError::Io`] when the directory cannot be removed.
    pub fn destroy(mut self) -> Result<(), FileCacheError> {
        if self.is_shared() {
            return Err(FileCacheError::Shared);
        }
        self.closed = true;
        remove_tree(self.file_dir())
    }

    /// Recompute every stored file's digest and compare it with its name.
    ///
    /// `delete_broken` removes the files whose content no longer matches, which is
    /// the only repair that can be made: a file whose bytes changed has no other
    /// name to be filed under.
    ///
    /// # Errors
    ///
    /// Whatever the backend reports while listing, opening or removing.
    pub async fn check_integrity(&self, delete_broken: bool) -> Result<bool, FileCacheError> {
        let mut clean = true;
        for file in self.backend.list().await? {
            let computed = self.recompute(&file.digest).await?;
            if computed == file.digest.as_str() {
                continue;
            }
            if delete_broken {
                self.delete(&CacheHandle::new(file.digest)).await?;
            }
            clean = false;
        }
        Ok(clean)
    }

    async fn recompute(&self, digest: &FileDigest) -> Result<String, FileCacheError> {
        let mut hasher = Digester::new();
        let mut buffer = vec![0_u8; CHUNK_SIZE];
        {
            // Closed first: a large object cannot be unlinked while a session holds it open.
            let mut source: Readable = self.backend.get_file(digest).await?;
            loop {
                let read = source.read(&mut buffer).await?;
                if read == 0 {
                    break;
                }
                hasher.update(&buffer[..read]);
            }
        }
        Ok(hasher.digest())
    }

    fn replace_temp_dir(&mut self) -> Result<(), FileCacheError> {
        let temp_dir = naming::create_directory(self.file_dir(), TEMPORARY_PREFIX)
            .map_err(|source| FileCacheError::io(self.file_dir(), source))?;
        self.temp_dir = temp_dir;
        Ok(())
    }
}
