//! Why a cache or backend operation stopped.
//!
//! The reference raised `KeyError` for a missing file, `TombstoneError` for the
//! tombstone, `RuntimeError` for a directory it could not create and `OSError` for
//! a stream, so a caller could tell them apart by type. Each one keeps its own
//! variant here for the same reason.

use std::io;
use std::path::PathBuf;

use crate::digest::{CacheError, DigestError, FileDigest};
use crate::fsobject::FsObjectError;
use crate::large_object::LargeObjectError;
use crate::session::SessionError;

/// What a cache or a backend refused.
#[derive(Debug, thiserror::Error)]
pub enum FileCacheError {
    /// The backend holds no file with this digest, which the reference's `KeyError` said.
    #[error("no file is stored with digest {0}")]
    Missing(FileDigest),
    /// The digest is the tombstone, so there is no content to read.
    #[error(transparent)]
    Tombstone(#[from] CacheError),
    /// A digest that came out of the file itself could not be read as one.
    #[error("{0} is not a digest")]
    Digest(#[from] DigestError),
    /// A large-object operation was refused.
    #[error(transparent)]
    LargeObject(#[from] LargeObjectError),
    /// A session could not be opened for a row statement.
    #[error(transparent)]
    Session(#[from] SessionError),
    /// An `fsobjects` operation was refused.
    #[error(transparent)]
    Objects(#[from] FsObjectError),
    /// A file or directory operation was refused.
    #[error("{path}: {source}")]
    Io {
        /// The path the operation named.
        path: PathBuf,
        /// What the system said.
        #[source]
        source: io::Error,
    },
    /// A directory the cache requires could not be created.
    #[error("cannot create the required directory {path}: {source}")]
    Directory {
        /// The directory that could not be created.
        path: PathBuf,
        /// What the system said.
        #[source]
        source: io::Error,
    },
    /// A writer one backend made was committed to another.
    #[error("a writer created by one backend cannot be committed to another")]
    ForeignWriter,
    /// A writer stored none of the bytes it was offered, which no stream should do.
    #[error("the backend stored none of the bytes it was offered")]
    ShortWrite,
    /// A cache shared with other services may not be destroyed.
    #[error("a cache shared with other services may not be destroyed")]
    Shared,
}

impl FileCacheError {
    /// A file or directory operation that named `path`.
    pub(crate) fn io(path: impl Into<PathBuf>, source: io::Error) -> Self {
        Self::Io {
            path: path.into(),
            source,
        }
    }

    /// A required directory that could not be created.
    pub(crate) fn directory(path: impl Into<PathBuf>, source: io::Error) -> Self {
        Self::Directory {
            path: path.into(),
            source,
        }
    }
}
