//! The files a worker hands a run, and the store a result of that run goes to.
//!
//! A run needs files before it runs: the managers it compiles with, the headers
//! those managers include, the testcase input it is judged on. A run leaves
//! files behind: the output it printed, the executable it produced, the
//! feedback a contestant is shown. [`Stage`] is both ends of that, over one
//! directory a run is handed, and [`Cache`] is where a file that outlives the
//! run is kept.
//!
//! Three shapes are held on purpose. A create is exclusive, so a run is never
//! given a file that was already there. A read takes a limit, so a run whose
//! output is large costs no more to look at than the caller asked for. A store
//! answers the digest it stored content under, which is the identity every file
//! already in the store is named by.
//!
//! The store is one trait with three backends, so a worker whose files are worth
//! keeping, a worker whose files are worth keeping in a database and a worker
//! that keeps nothing are the same code with a different value. The tombstone is
//! refused by the digest mapping all three share, before any of them is asked
//! where a file is.
//!
//! # Errors
//!
//! [`StageError`], and only that: a path already staged, a path with no file, a
//! digest no store holds, a store that refused in its own words, and the
//! tombstone, which [`CacheHandle::open`] reports as [`CacheError::Tombstone`].

#![deny(missing_docs)]
#![forbid(unsafe_code)]

mod cache;
mod files;

use std::fmt;
use std::path::PathBuf;

pub use cache::{Cache, DatabaseCache, FsCache, LargeObjects, NullCache, PrecacheLock};
pub use cms_db::{CacheError, CacheHandle, DigestError, FileDigest};
pub use files::{Stage, DEFAULT_READ_LIMIT, MODE_EXECUTABLE, MODE_PLAIN};

/// Why a file could not be staged, read or stored.
///
/// Every variant says which path or digest to look at, so a refusal names the
/// file rather than reporting that a file was not there.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StageError {
    /// The run already has a file at this path, and a create is exclusive.
    AlreadyExists {
        /// The path the run already has a file at.
        path: PathBuf,
    },
    /// No store holds content under this digest.
    NotStored {
        /// The digest nothing was found for.
        digest: FileDigest,
    },
    /// The handle names the tombstone, which holds no content to be read.
    Cache(CacheError),
    /// The digest is not one the `DIGEST` domain admits.
    Digest(DigestError),
    /// The large objects a store was handed refused in their own words.
    Store {
        /// What the store said, in its own terms.
        reason: String,
    },
    /// The file system refused an operation on this path.
    Io {
        /// The path the operation was on.
        path: PathBuf,
        /// What the file system refused it with.
        kind: std::io::ErrorKind,
    },
}

impl StageError {
    /// The refusal an operation on a path reports, as the kind it failed with.
    pub(crate) fn io(path: impl Into<PathBuf>, source: &std::io::Error) -> Self {
        Self::Io {
            path: path.into(),
            kind: source.kind(),
        }
    }

    /// The refusal a store answers with when it holds no content under a digest.
    pub(crate) fn not_stored(digest: &FileDigest) -> Self {
        Self::NotStored {
            digest: digest.clone(),
        }
    }
}

impl From<CacheError> for StageError {
    fn from(error: CacheError) -> Self {
        Self::Cache(error)
    }
}

impl fmt::Display for StageError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::AlreadyExists { path } => {
                write!(f, "a file is already staged at {}", path.display())
            }
            Self::NotStored { digest } => {
                write!(f, "no content is stored under digest {}", digest.as_str())
            }
            Self::Cache(error) => write!(f, "{error}"),
            Self::Digest(error) => write!(f, "{error}"),
            Self::Store { reason } => write!(f, "the store refused: {reason}"),
            Self::Io { path, kind } => write!(f, "{kind:?} at {}", path.display()),
        }
    }
}

impl std::error::Error for StageError {}
