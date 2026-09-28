//! What a run leaves behind, kept as one archive under one digest.
//!
//! `cms.grading.Sandbox.archive` packs the directory a run operated in, hands the
//! packed bytes to the file cacher and answers with the digest they are addressed
//! by; a failure to pack is `None` there, and a named refusal here.
//!
//! The pack is one walk and one stream: the run's own directory is appended to a
//! tar builder whose sink is a gzip encoder, and the encoder is finished once the
//! walk is over, so the archive is compressed as it is built rather than after it.
//! Nothing follows a link, so a run that left one pointing into its own directory
//! costs a link in the archive and not a walk that never ends.
//!
//! The directory is archived under its own name, which is what the reference
//! archives it as, so a run's files are at `home/...` inside the archive instead
//! of spread across its top. The packed copy is written where the store can reach
//! it and removed as soon as the store has it, so a run's own directory never
//! keeps the archive made of itself.
//!
//! # Errors
//!
//! [`ArchiveError`], and nothing else: a directory that could not be walked or
//! read, an archive that could not be finished, and a stage or a store that
//! refused the packed archive. Every refusal names the path it was about, and no
//! digest is answered unless the store took the whole archive.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::fs;
use std::path::{Path, PathBuf};

use flate2::write::GzEncoder;
use flate2::Compression;
use tar::Builder;

use super::Sandbox;
use crate::stage::{FileDigest, Stage, StageError};

/// The name the packed archive is written under where the store can reach it.
///
/// No run is handed a file of that name, and it is gone before the next walk of
/// the same directory, so it is never a file inside a later archive.
const ARCHIVE_NAME: &str = "sandbox-archive.tar.gz";

/// The name a root with no name of its own is archived under, which is the one
/// walk nothing here can call a directory.
const UNNAMED_ROOT: &str = "sandbox";

/// Why a run's directory was not archived.
#[derive(Debug, thiserror::Error)]
pub enum ArchiveError {
    /// The run's own directory could not be walked, read, or compressed.
    #[error("cannot archive {path}: {source}")]
    Io {
        /// The directory the archive was being made of.
        path: PathBuf,
        /// What the walk, the read or the compressor refused it with.
        source: std::io::Error,
    },
    /// The stage or the store refused the packed archive, so no digest is
    /// answered.
    #[error("cannot file the archive of {path}: {source}")]
    Store {
        /// The directory the archive was made of, or the file the packed copy was
        /// written to.
        path: PathBuf,
        /// What the stage or the store refused it with.
        source: StageError,
    },
}

impl Sandbox {
    /// Archives the run's own directory and files it in the store.
    ///
    /// The digest is a SHA-1 over the packed archive, which is what every file in
    /// the store is named by, so a directory archived twice with nothing changed
    /// in between is filed under the digest it was filed under before.
    ///
    /// # Errors
    ///
    /// [`ArchiveError::Io`] for a directory that could not be walked or read and
    /// for an archive that could not be finished, then [`ArchiveError::Store`]
    /// for a stage or a store that refused the bytes. The store is asked last, so
    /// a refusal before it leaves nothing filed and a refusal at it leaves no
    /// archive.
    pub fn archive(&self, stage: &Stage) -> Result<FileDigest, ArchiveError> {
        let packed = pack(self.home())?;
        file_in(stage, self.home(), &packed)
    }
}

/// Packs a directory into one gzipped tar, held as a single buffer.
///
/// # Errors
///
/// [`ArchiveError::Io`], and nothing else: a directory that could not be walked
/// or read, and a compressor that could not finish what it was given.
fn pack(root: &Path) -> Result<Vec<u8>, ArchiveError> {
    let encoder = GzEncoder::new(Vec::new(), Compression::default());
    let mut builder = Builder::new(encoder);
    builder.follow_symlinks(false);
    if let Err(source) = builder.append_dir_all(arcname(root), root) {
        return Err(io_error(root, source));
    }
    let encoder = builder
        .into_inner()
        .map_err(|source| io_error(root, source))?;
    encoder.finish().map_err(|source| io_error(root, source))
}

/// The name a directory is archived under inside the archive.
///
/// A root with no name of its own is the one walk here that has nothing to call,
/// and a tar entry needs a name it can be written under, so that root is named
/// rather than refused for a reason the caller cannot act on.
fn arcname(root: &Path) -> String {
    root.file_name().map_or_else(
        || UNNAMED_ROOT.to_owned(),
        |name| name.to_string_lossy().into_owned(),
    )
}

/// Writes the packed archive where the store can reach it, and answers the digest
/// it is filed under.
///
/// # Errors
///
/// [`ArchiveError::Store`], and nothing else: the bytes are already packed by the
/// time this is reached, so a store is the only thing left that can refuse.
fn file_in(stage: &Stage, root: &Path, packed: &[u8]) -> Result<FileDigest, ArchiveError> {
    let temporary = Temporary::written(stage, root, packed)?;
    temporary.filed(stage)
}

/// The packed archive, written into a stage and removed as this is dropped.
///
/// Dropping is what removes it, so a store that refused the bytes takes the
/// archive away with it rather than leaving a copy of the run inside the run.
struct Temporary {
    path: PathBuf,
    root: PathBuf,
}

impl Temporary {
    /// Writes the packed archive into the stage it is to be filed from.
    ///
    /// # Errors
    ///
    /// [`ArchiveError::Store`] when the stage could not write the archive. The
    /// create is exclusive, so a file the run already owns at that name is
    /// refused rather than overwritten.
    fn written(stage: &Stage, root: &Path, packed: &[u8]) -> Result<Self, ArchiveError> {
        let path = stage.path(ARCHIVE_NAME);
        let refusal = |source| ArchiveError::Store {
            path: path.clone(),
            source,
        };
        stage.write(ARCHIVE_NAME, packed, false).map_err(refusal)?;
        Ok(Self {
            path,
            root: root.to_path_buf(),
        })
    }

    /// The digest the store filed the archive under, with the archive removed as
    /// this goes out of scope.
    ///
    /// # Errors
    ///
    /// [`ArchiveError::Store`] for a store that refused the bytes, and nothing
    /// else. The archive is removed whether the store took it or refused it.
    fn filed(self, stage: &Stage) -> Result<FileDigest, ArchiveError> {
        let refusal = |source| ArchiveError::Store {
            path: self.root.clone(),
            source,
        };
        stage.store(ARCHIVE_NAME).map_err(refusal)
    }
}

impl Drop for Temporary {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

/// The refusal a walk, a read or a compressor gives, naming what it was about.
fn io_error(root: &Path, source: std::io::Error) -> ArchiveError {
    ArchiveError::Io {
        path: root.to_path_buf(),
        source,
    }
}
