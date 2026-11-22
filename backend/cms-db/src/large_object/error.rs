//! Why a large-object operation stopped, and which statement stopped it.
//!
//! The reference turned every failure into one `OSError` carrying the sentence it
//! passed in, so the sentence was the only thing that told a failed `lo_open` from
//! a failed `lowrite`. Each variant here names its statement for the same reason.

use crate::session::SessionError;

/// What the server refused, or what the handle refused to do.
#[derive(Debug, thiserror::Error)]
pub enum LargeObjectError {
    /// The object was closed, so its descriptor is gone.
    #[error("large object {loid} is closed")]
    Closed {
        /// The object the caller held.
        loid: u32,
    },
    /// The object was opened for writing only.
    #[error("large object {loid} was not opened for reading")]
    NotReadable {
        /// The object the caller held.
        loid: u32,
    },
    /// The object was opened for reading only.
    #[error("large object {loid} was not opened for writing")]
    NotWritable {
        /// The object the caller held.
        loid: u32,
    },
    /// An offset, or a size, outside what the 32-bit statement parameters carry.
    #[error("the position does not fit the 32-bit offset lo_lseek and lo_truncate take")]
    PositionOutOfRange,
    /// The dedicated connection could not be opened.
    #[error(transparent)]
    Session(#[from] SessionError),
    /// `lo_create`.
    #[error("lo_create was refused: {source}")]
    Create {
        /// What the server said.
        #[source]
        source: sqlx::Error,
    },
    /// `lo_open`.
    #[error("lo_open was refused for large object {loid}: {source}")]
    Open {
        /// The object the caller asked for.
        loid: u32,
        /// What the server said.
        #[source]
        source: sqlx::Error,
    },
    /// `loread`.
    #[error("loread was refused for large object {loid}: {source}")]
    Read {
        /// The object being read.
        loid: u32,
        /// What the server said.
        #[source]
        source: sqlx::Error,
    },
    /// `lowrite`.
    #[error("lowrite was refused for large object {loid}: {source}")]
    Write {
        /// The object being written.
        loid: u32,
        /// What the server said.
        #[source]
        source: sqlx::Error,
    },
    /// `lo_lseek`.
    #[error("lo_lseek was refused for large object {loid}: {source}")]
    Seek {
        /// The object being moved in.
        loid: u32,
        /// What the server said.
        #[source]
        source: sqlx::Error,
    },
    /// `lo_tell`.
    #[error("lo_tell was refused for large object {loid}: {source}")]
    Tell {
        /// The object being measured.
        loid: u32,
        /// What the server said.
        #[source]
        source: sqlx::Error,
    },
    /// `lo_truncate`.
    #[error("lo_truncate was refused for large object {loid}: {source}")]
    Truncate {
        /// The object being shortened.
        loid: u32,
        /// What the server said.
        #[source]
        source: sqlx::Error,
    },
    /// `lo_close` or the commit that follows it.
    #[error("lo_close was refused for large object {loid}: {source}")]
    Close {
        /// The object being closed.
        loid: u32,
        /// What the server said.
        #[source]
        source: sqlx::Error,
    },
    /// `lo_unlink`.
    #[error("lo_unlink was refused for large object {loid}: {source}")]
    Unlink {
        /// The object being destroyed.
        loid: u32,
        /// What the server said.
        #[source]
        source: sqlx::Error,
    },
}
