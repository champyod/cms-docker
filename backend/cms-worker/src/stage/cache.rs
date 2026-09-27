//! Where the content of a stored file lives: the trait and its three backends.
//!
//! `cms.db.filecacher.FileCacherBackend` is the shape here. The reference also
//! has `describe`, `get_size`, `delete` and `list`, and a description to go with
//! them; no path that stages a file reads any of those, so this trait carries
//! the two operations storing and retrieving content do, and drops the
//! description as the reference's own filesystem backend drops it.
//!
//! The three backends are a directory, a database and nothing, and all three
//! refuse the tombstone in one place: they ask the digest mapping which file to
//! look for, because that refusal belongs to a digest and not to a store.
//!
//! # Errors
//!
//! [`StageError`], and only that: content no store holds, a path a store cannot
//! read or write, a store that refused in its own words, and the tombstone,
//! which [`CacheHandle::open`] reports as [`cms_db::CacheError::Tombstone`].

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::fs::{self, File, OpenOptions, TryLockError};
use std::io::Write as _;
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use cms_db::{CacheHandle, FileDigest};

use super::StageError;

/// The file a precache lock is held on, inside the shared cache directory.
const LOCK_FILE: &str = "cache_lock";

/// The mode a stored file is given, so only the service user may read it: a
/// mode narrows what the process umask allows and never widens it.
const MODE_STORED: u32 = 0o600;

/// What the staged files of one process are named apart by, so two writers in
/// one process never write into the same staged file.
static STAGING_SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// Where the content of a stored file lives. A digest names content, so all a
/// store reports is whether it already had the bytes it was handed.
pub trait Cache {
    /// The content a handle names.
    ///
    /// # Errors
    ///
    /// [`StageError::Cache`] for the tombstone, [`StageError::NotStored`] when
    /// the store holds no content under the digest, and whatever the store
    /// itself refuses with.
    fn get_file(&self, handle: &CacheHandle) -> Result<Vec<u8>, StageError>;

    /// Stores content under a digest, and says whether this call stored it.
    ///
    /// # Errors
    ///
    /// Whatever the store refuses with. A digest is never the tombstone on the
    /// way in: it is the identity the caller computed over the content.
    fn put_file(&self, digest: &FileDigest, content: &[u8]) -> Result<bool, StageError>;
}

/// A store that keeps every file in a directory, named after its digest, which
/// may be a directory shared with other services.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FsCache {
    root: PathBuf,
}

impl FsCache {
    /// A store of `root`, which is created when it is not there yet.
    ///
    /// # Errors
    ///
    /// [`StageError::Io`] when the directory cannot be made.
    pub fn at(root: impl Into<PathBuf>) -> Result<Self, StageError> {
        let root = root.into();
        fs::create_dir_all(&root).map_err(|source| StageError::io(&root, &source))?;
        Ok(Self { root })
    }

    /// The path a digest is kept at.
    fn path_of(&self, digest: &FileDigest) -> PathBuf {
        self.root.join(digest.as_str())
    }

    /// Writes content beside its digest and renames it into place.
    ///
    /// The rename is atomic, so a reader never opens a partly written file and a
    /// crash leaves the staged file rather than a short one. It also replaces a
    /// file another writer put there in between the check and the rename, which
    /// costs nothing: the name is the content's own digest, so the file that
    /// lost the race held these same bytes.
    fn rename_into_place(&self, digest: &FileDigest, content: &[u8]) -> Result<(), StageError> {
        let staged = self.root.join(staging_name(digest));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true).mode(MODE_STORED);
        let written = options
            .open(&staged)
            .and_then(|mut file| file.write_all(content));
        if let Err(source) = written {
            return Err(StageError::io(&staged, &source));
        }
        let target = self.path_of(digest);
        fs::rename(&staged, &target).map_err(|source| StageError::io(&target, &source))
    }
}

impl Cache for FsCache {
    fn get_file(&self, handle: &CacheHandle) -> Result<Vec<u8>, StageError> {
        let digest = handle.open()?;
        let path = self.path_of(digest);
        fs::read(&path).map_err(|source| absent(digest, &path, &source))
    }

    fn put_file(&self, digest: &FileDigest, content: &[u8]) -> Result<bool, StageError> {
        if self.path_of(digest).exists() {
            return Ok(false);
        }
        self.rename_into_place(digest, content)?;
        Ok(true)
    }
}

/// The large objects a database-backed store keeps its content in.
///
/// `DBBackend` reaches content only through a session, and the pool and the
/// transaction behind one belong to whoever supplies it, so this is the whole of
/// what a [`DatabaseCache`] asks for. A store that fails reports it as
/// [`StageError::Store`], the one arm no path here produces itself.
pub trait LargeObjects {
    /// The content of a large object, absent when the store holds none.
    ///
    /// # Errors
    ///
    /// [`StageError::Store`] when the store refused to answer.
    fn get(&self, digest: &str) -> Result<Option<Vec<u8>>, StageError>;

    /// Stores a large object, and says whether this call stored it.
    ///
    /// # Errors
    ///
    /// [`StageError::Store`] when the store refused to write.
    fn put(&self, digest: &str, content: &[u8]) -> Result<bool, StageError>;
}

/// A store that keeps content in a database, reached only through its objects.
pub struct DatabaseCache<O> {
    objects: O,
}

impl<O: LargeObjects> DatabaseCache<O> {
    /// A store whose content lives in `objects`.
    #[must_use]
    pub const fn new(objects: O) -> Self {
        Self { objects }
    }
}

impl<O: LargeObjects> Cache for DatabaseCache<O> {
    fn get_file(&self, handle: &CacheHandle) -> Result<Vec<u8>, StageError> {
        let digest = handle.open()?;
        self.objects
            .get(digest.as_str())?
            .map_or_else(|| Err(StageError::not_stored(digest)), Ok)
    }

    fn put_file(&self, digest: &FileDigest, content: &[u8]) -> Result<bool, StageError> {
        self.objects.put(digest.as_str(), content)
    }
}

/// A store that keeps nothing and drops every file it is handed, for a worker
/// whose only copy of a file's content is the cache in front of it.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct NullCache;

impl Cache for NullCache {
    fn get_file(&self, handle: &CacheHandle) -> Result<Vec<u8>, StageError> {
        Err(StageError::not_stored(handle.open()?))
    }

    fn put_file(&self, _digest: &FileDigest, _content: &[u8]) -> Result<bool, StageError> {
        Ok(false)
    }
}

/// The exclusive lock one process holds while it fills the shared cache.
///
/// The lock is the kernel's and is held on an open file, so a process that dies
/// releases it. Locking is optional: cache operations go on while it is held,
/// and only precaching is spared.
#[derive(Debug)]
pub struct PrecacheLock {
    path: PathBuf,
    file: File,
}

impl PrecacheLock {
    /// Takes the lock in `cache_dir`, or answers `None` when it is held.
    ///
    /// # Errors
    ///
    /// [`StageError::Io`] when the lock file cannot be opened or locked for any
    /// reason other than the lock being held already.
    pub fn take(cache_dir: &Path) -> Result<Option<Self>, StageError> {
        let path = cache_dir.join(LOCK_FILE);
        let mut options = OpenOptions::new();
        options.write(true).create(true).truncate(false);
        let file = options
            .open(&path)
            .map_err(|source| StageError::io(&path, &source))?;
        match file.try_lock() {
            Ok(()) => Ok(Some(Self { path, file })),
            Err(TryLockError::WouldBlock) => Ok(None),
            Err(TryLockError::Error(source)) => Err(StageError::io(&path, &source)),
        }
    }

    /// Releases the lock, so that another process may take it. Letting this value
    /// go out of scope releases it too, which is what the reference's closing
    /// the file object it returns relies on.
    ///
    /// # Errors
    ///
    /// [`StageError::Io`] when the kernel refuses to let it go.
    pub fn release(self) -> Result<(), StageError> {
        self.file
            .unlock()
            .map_err(|source| StageError::io(&self.path, &source))
    }
}

/// A staged file's name, beside the file it will become. The process id and the
/// sequence keep one digest's staged file apart from another's, here and
/// anywhere else.
fn staging_name(digest: &FileDigest) -> String {
    let sequence = STAGING_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!(".tmp.{}.{sequence}.{}", digest.as_str(), std::process::id())
}

/// What a store that holds nothing under a digest answers with. A file that has
/// gone from a directory is the same answer as a database holding no row for it.
fn absent(digest: &FileDigest, path: &Path, source: &std::io::Error) -> StageError {
    if source.kind() == std::io::ErrorKind::NotFound {
        return StageError::not_stored(digest);
    }
    StageError::io(path, source)
}
