//! A local cache in front of a backend, so a file is fetched once per machine.
//!
//! This is `cms.db.filecacher.FileCacher`: a directory named after each digest,
//! filled from a backend on the first read and written to it on every put.
//!
//! Two pieces of the reference had no counterpart here, and neither is imitated:
//!
//! - `gevent` made the copy loops cooperative so a greenlet copying a large file
//!   did not stall the others. Rust has no greenlet scheduler, so the loops are
//!   plain blocking disk copies and the suspension points are the database awaits
//!   inside a large-object read or write — which is where a chunk would have
//!   yielded anyway. No timeout is lost: the reference had none in this file, only
//!   the `sleep(0)` yields.
//! - `atexit` removed the two temporary directories on exit. That became
//!   [`FileCache::close`], which returns the failure, plus a destructor that calls
//!   it, so the ordinary path is an explicit shutdown rather than a handler that
//!   runs after the runtime has stopped.
//!
//! There is no retry and no deferral to port: the reference has none in this file.
//! Its only concurrency handling is the `except IntegrityError` of
//! `DBBackend.commit_file`, which is the dedup path and is reproduced as the
//! unique-violation branch of `DbBackend::commit`, not as a retry.

mod backend;
mod error;
mod manage;
mod naming;
mod read;
mod store;
mod write;

pub use backend::{Backend, DbBackend, FsBackend, NullBackend, StoredFile};
pub use error::FileCacheError;
pub use store::{Readable, Writable};

use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};

/// The step every copy is made in, `FileCacher.CHUNK_SIZE`.
///
/// A multiple of the 2048-byte large-object page and of `io.DEFAULT_BUFFER_SIZE`,
/// which is why the reference chose it and why it stays.
pub const CHUNK_SIZE: usize = 1024 * 1024;

/// Where a shared cache sits under the cache root.
const SHARED_DIRECTORY: &str = "fs-cache-shared";

/// The temporary directory a cache downloads into, inside its own directory so a
/// rename never crosses a filesystem.
const TEMPORARY_PREFIX: &str = "_temp";

/// The file `precache_lock` holds.
const LOCK_FILE: &str = "cache_lock";

/// Whether a cache belongs to one process or to every service on the machine.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CacheScope {
    /// A directory of this process's own, removed when it closes.
    Private,
    /// One directory per machine, kept between runs.
    Shared,
}

/// What a cache needs to open: its storage, and the two roots it works under.
pub struct FileCacheConfig {
    /// The storage the cache fills itself from.
    pub backend: Backend,
    /// `[global] temp_dir`, under which a private cache's directory is made.
    pub temp_root: PathBuf,
    /// `[global] cache_dir`, the parent of a shared cache's directory.
    pub cache_root: PathBuf,
    /// Whether this cache is private or shared.
    pub scope: CacheScope,
}

/// A directory of files named by digest, filled from a backend.
pub struct FileCache {
    backend: Backend,
    file_dir: PathBuf,
    temp_dir: PathBuf,
    scope: CacheScope,
    owns_file_dir: bool,
    closed: bool,
}

impl FileCache {
    /// Create the directories the cache works in and open the cache.
    ///
    /// # Errors
    ///
    /// [`FileCacheError::Directory`] when a required directory cannot be created.
    pub fn open(config: FileCacheConfig) -> Result<Self, FileCacheError> {
        create_directory(&config.temp_root)?;
        create_directory(&config.cache_root)?;

        let (file_dir, owns_file_dir) = match config.scope {
            CacheScope::Private => {
                let directory = naming::create_directory(&config.temp_root, "")
                    .map_err(|source| FileCacheError::io(&config.temp_root, source))?;
                (directory, true)
            }
            CacheScope::Shared => (config.cache_root.join(SHARED_DIRECTORY), false),
        };
        create_directory(&file_dir)?;

        let temp_dir = naming::create_directory(&file_dir, TEMPORARY_PREFIX)
            .map_err(|source| FileCacheError::io(&file_dir, source))?;

        Ok(Self {
            backend: config.backend,
            file_dir,
            temp_dir,
            scope: config.scope,
            owns_file_dir,
            closed: false,
        })
    }

    /// Whether the directory is shared with other services.
    #[must_use]
    pub fn is_shared(&self) -> bool {
        self.scope == CacheScope::Shared
    }

    /// The directory the cached files live in.
    #[must_use]
    pub fn file_dir(&self) -> &Path {
        &self.file_dir
    }

    /// The directory a download is assembled in before it is renamed into place.
    #[must_use]
    pub fn temp_dir(&self) -> &Path {
        &self.temp_dir
    }

    /// The storage this cache is filled from.
    #[must_use]
    pub const fn backend(&self) -> &Backend {
        &self.backend
    }

    /// Remove the directories this instance made, reporting a failure.
    ///
    /// This is what the reference's `atexit` handlers did, made explicit: an
    /// operator that wants to know a directory survived gets an answer here.
    ///
    /// # Errors
    ///
    /// [`FileCacheError::Io`] for the first directory that could not be removed.
    pub fn close(mut self) -> Result<(), FileCacheError> {
        self.remove_temporary()
    }

    /// Lock the shared cache for precaching, if nothing else holds it.
    ///
    /// Locking is cooperative: normal reads and writes ignore it, and its only job
    /// is to keep every worker on a machine from precaching at once. Closing the
    /// returned file releases the lock.
    ///
    /// # Errors
    ///
    /// [`FileCacheError::Io`] when the lock file cannot be created or locked for a
    /// reason other than another holder.
    pub fn precache_lock(&self) -> Result<Option<File>, FileCacheError> {
        let path = self.file_dir.join(LOCK_FILE);
        let file = File::create(&path).map_err(|source| FileCacheError::io(&path, source))?;
        match file.try_lock() {
            Ok(()) => Ok(Some(file)),
            Err(fs::TryLockError::WouldBlock) => Ok(None),
            Err(fs::TryLockError::Error(source)) => Err(FileCacheError::io(path, source)),
        }
    }

    pub(crate) fn cache_path(&self, digest: &crate::digest::FileDigest) -> PathBuf {
        self.file_dir.join(digest.as_str())
    }

    fn remove_temporary(&mut self) -> Result<(), FileCacheError> {
        if self.closed {
            return Ok(());
        }
        self.closed = true;
        let mut directories = vec![self.temp_dir.clone()];
        if self.owns_file_dir {
            directories.push(self.file_dir.clone());
        }
        let mut failure = None;
        for directory in directories {
            if let Err(error) = remove_tree(&directory) {
                failure.get_or_insert(error);
            }
        }
        failure.map_or(Ok(()), Err)
    }
}

impl Drop for FileCache {
    /// WHY best effort: a destructor has no channel to report through, so `close`
    /// is the path a caller who needs the failure takes; this keeps the
    /// directories from surviving a caller that never took it.
    fn drop(&mut self) {
        let _ = self.remove_temporary();
    }
}

pub(crate) fn create_directory(path: &Path) -> Result<(), FileCacheError> {
    fs::create_dir_all(path).map_err(|source| FileCacheError::directory(path, source))
}

/// Remove one file, treating an already-absent one as removed.
pub(crate) fn remove_file(path: &Path) -> Result<(), FileCacheError> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(source) => Err(FileCacheError::io(path, source)),
    }
}

pub(crate) fn remove_tree(path: &Path) -> Result<(), FileCacheError> {
    match fs::remove_dir_all(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(source) => Err(FileCacheError::io(path, source)),
    }
}
