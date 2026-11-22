//! Why a row could not be read, written or removed.
//!
//! The reference let `SQLAlchemyError` through and turned a bad digest into a
//! `ValueError`, so the three failures a caller handles — missing, refused, and a
//! column the domain would have refused — were told apart by type alone.

use crate::digest::{DigestError, FileDigest};
use crate::large_object::LargeObjectError;
use crate::session::SessionError;

/// Why a row could not be read, written or removed.
#[derive(Debug, thiserror::Error)]
pub enum FsObjectError {
    /// The dedicated connection a large object needs could not be opened.
    #[error(transparent)]
    Session(#[from] SessionError),
    /// The large object could not be opened or unlinked.
    #[error(transparent)]
    LargeObject(#[from] LargeObjectError),
    /// A `DIGEST` column held a value the domain would have refused.
    #[error("{digest} is not a digest: {source}")]
    Digest {
        /// The value the column held.
        digest: String,
        /// The rule it broke.
        #[source]
        source: DigestError,
    },
    /// The row could not be read.
    #[error("selecting from fsobjects was refused: {source}")]
    Select {
        /// What the server said.
        #[source]
        source: sqlx::Error,
    },
    /// The row could not be written.
    #[error("inserting into fsobjects was refused: {source}")]
    Insert {
        /// What the server said.
        #[source]
        source: sqlx::Error,
    },
    /// The row could not be removed.
    #[error("deleting from fsobjects was refused: {source}")]
    Delete {
        /// What the server said.
        #[source]
        source: sqlx::Error,
    },
    /// The row names no large object, so there are no bytes to open.
    #[error("{0} carries no large object: its loid is the column's default 0")]
    NoLargeObject(FileDigest),
}
