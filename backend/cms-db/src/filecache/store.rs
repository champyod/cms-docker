//! The byte streams a backend hands out, and the copy between them.
//!
//! The reference's backends returned Python file objects, so a caller could read
//! from and write to any backend the same way. Two enums keep that property here
//! without a boxed future per call: a stream is either a file on disk or a large
//! object, and the copy loops are the only code that has to know which.
//!
//! `gevent.sleep(0)` is reproduced, not dropped: the reference yielded between chunks
//! so other greenlets could run, and that matters here because a file-backed read and
//! write are both blocking and never suspend on their own. Without a yield a
//! multi-gigabyte copy would hold its worker for the whole transfer, so both loops
//! yield after every chunk. Only the large-object side would have suspended anyway.

use std::fs::File;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use crate::large_object::LargeObject;

use super::FileCacheError;

/// A file open for reading, from disk or from the database.
pub enum Readable {
    /// A file in a cache or backend directory.
    File {
        /// The open file.
        file: File,
        /// Where it lives, for an error that has to name it.
        path: PathBuf,
    },
    /// A large object, read through its own connection.
    LargeObject(LargeObject),
}

impl Readable {
    /// Read into `buf`, returning how many bytes were read, zero at the end.
    ///
    /// # Errors
    ///
    /// [`FileCacheError::Io`] for a disk file and [`FileCacheError::LargeObject`]
    /// for a large object.
    pub async fn read(&mut self, buf: &mut [u8]) -> Result<usize, FileCacheError> {
        match self {
            Self::File { file, path } => io::Read::read(file, buf)
                .map_err(|source| FileCacheError::io(path.as_path(), source)),
            Self::LargeObject(object) => object.read(buf).await.map_err(Into::into),
        }
    }
}

/// A file open for writing, into a backend directory or a new large object.
pub enum Writable {
    /// A named temporary file the backend's commit renames into place.
    File {
        /// The open file.
        file: File,
        /// Where it lives, which is what the commit renames.
        path: PathBuf,
    },
    /// A large object whose bytes commit when it closes.
    LargeObject(LargeObject),
}

impl Writable {
    /// Where a file-backed writer will be renamed from.
    #[must_use]
    pub fn path(&self) -> Option<&Path> {
        match self {
            Self::File { path, .. } => Some(path),
            Self::LargeObject(_) => None,
        }
    }

    /// Write all of `bytes`, calling the stream as often as it takes.
    ///
    /// # Errors
    ///
    /// [`FileCacheError::Io`] for a disk file and [`FileCacheError::LargeObject`]
    /// for a large object.
    pub async fn write_all(&mut self, bytes: &[u8]) -> Result<(), FileCacheError> {
        match self {
            Self::File { file, path } => file
                .write_all(bytes)
                .map_err(|source| FileCacheError::io(path.as_path(), source)),
            Self::LargeObject(object) => {
                let mut remaining = bytes;
                while !remaining.is_empty() {
                    let written = object.write(remaining).await?;
                    if written == 0 {
                        return Err(FileCacheError::ShortWrite);
                    }
                    remaining = &remaining[written..];
                }
                Ok(())
            }
        }
    }
}

/// Copy everything `source` holds into `destination`, in `chunk` steps.
///
/// # Errors
///
/// [`FileCacheError::Io`] naming `destination_path` when the write fails, and
/// whatever the source's read reports.
pub(crate) async fn copy_to_file(
    source: &mut Readable,
    destination: &mut File,
    destination_path: &Path,
    chunk: usize,
) -> Result<u64, FileCacheError> {
    let mut buffer = vec![0_u8; chunk];
    let mut total = 0_u64;
    loop {
        let read = source.read(&mut buffer).await?;
        if read == 0 {
            return Ok(total);
        }
        destination
            .write_all(&buffer[..read])
            .map_err(|source| FileCacheError::io(destination_path, source))?;
        total += read as u64;
        // The file half of this loop is blocking and never suspends on its own, so a
        // multi-gigabyte copy would hold its worker for the whole transfer. The
        // reference yields after every chunk for the same reason (`gevent.sleep(0)`,
        // filecacher.py:774, commented "Cooperative yield").
        tokio::task::yield_now().await;
    }
}

/// Copy everything `source` holds into a backend writer, in `chunk` steps.
///
/// # Errors
///
/// [`FileCacheError::Io`] naming `source_path` when the read fails, and whatever
/// the write reports.
pub(crate) async fn copy_to_writable(
    source: &mut File,
    destination: &mut Writable,
    source_path: &Path,
    chunk: usize,
) -> Result<u64, FileCacheError> {
    let mut buffer = vec![0_u8; chunk];
    let mut total = 0_u64;
    loop {
        let read = io::Read::read(source, &mut buffer)
            .map_err(|error| FileCacheError::io(source_path, error))?;
        if read == 0 {
            return Ok(total);
        }
        destination.write_all(&buffer[..read]).await?;
        total += read as u64;
        // Same reason as `copy_to_file`: the read is blocking, and a backend whose
        // write completes without suspending (Null, a small local file) would
        // otherwise make this loop run to completion on one worker.
        tokio::task::yield_now().await;
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    use super::*;

    /// A path in the scratch directory, unique enough that parallel tests never meet.
    fn scratch(name: &str) -> PathBuf {
        let unique = format!("cms-store-{}-{}", std::process::id(), name);
        std::env::temp_dir().join(unique)
    }

    /// A copy that never suspends holds its worker for the whole transfer, which is
    /// what the reference avoided by yielding after each chunk.
    ///
    /// On a single-threaded runtime a spawned task can only run if the copy gives the
    /// scheduler a turn, so the flag makes the yield observable. Remove the yield and
    /// this fails; that is the point of the test.
    #[tokio::test(flavor = "current_thread")]
    async fn a_copy_gives_the_scheduler_a_turn_between_chunks() {
        const CHUNK: usize = 8;
        let source_path = scratch("source");
        let destination_path = scratch("destination");
        std::fs::write(&source_path, vec![7_u8; CHUNK * 4]).expect("writing the source");

        let mut source = File::open(&source_path).expect("opening the source");
        let file = File::create(&destination_path).expect("creating the destination");
        let mut destination = Writable::File {
            file,
            path: destination_path.clone(),
        };

        let ran = Arc::new(AtomicBool::new(false));
        let observed = Arc::clone(&ran);
        tokio::spawn(async move {
            observed.store(true, Ordering::SeqCst);
        });

        let copied = copy_to_writable(&mut source, &mut destination, &source_path, CHUNK)
            .await
            .expect("copying the file");

        assert_eq!(copied, (CHUNK * 4) as u64, "every byte must be copied");
        assert!(
            ran.load(Ordering::SeqCst),
            "the copy never gave the scheduler a turn, so it held its worker for the whole transfer"
        );

        drop(destination);
        std::fs::remove_file(&source_path).ok();
        std::fs::remove_file(&destination_path).ok();
    }
}
