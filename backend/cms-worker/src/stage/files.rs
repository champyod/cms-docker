//! The files one run stages: created, written into, read back and stored.
//!
//! `cms.grading.Sandbox` addresses a file by its path inside a run, and this is
//! that directory and those four operations. A create is exclusive, as
//! `os.open` with `O_CREAT | O_EXCL` is, because a run that silently overwrites
//! a file it was handed is a run whose result cannot be read. The mode a file is
//! given is the one the run will use it under, and it is set after the file
//! exists, so the process umask cannot narrow a file the run has to execute.
//!
//! Nothing here launches anything. A file is created, written, read and stored
//! because a caller said so, and the store behind it is whatever the worker was
//! built with.
//!
//! # Errors
//!
//! [`StageError`], and only that: a path already taken, a path with no file, a
//! digest the store refuses, and the tombstone, which the digest mapping
//! reports before the store is asked for it.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::fs::{self, File, OpenOptions, Permissions};
use std::io::{Read, Write};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::str::FromStr;

use sha1::{Digest, Sha1};

use cms_db::{CacheHandle, FileDigest, DIGEST_HEX_LEN};

use super::{Cache, StageError};

/// The mode a staged file is given when the run only reads and writes it.
pub const MODE_PLAIN: u32 = 0o644;

/// The mode a staged file is given when the run is to execute it.
pub const MODE_EXECUTABLE: u32 = 0o755;

/// The bytes a read answers with when the caller sets no limit of its own.
pub const DEFAULT_READ_LIMIT: usize = 1024;

/// The files one run stages, and the store a result of that run goes to.
pub struct Stage {
    root: PathBuf,
    cache: Box<dyn Cache>,
}

impl Stage {
    /// A stage rooted at `root`, storing its results in `cache`.
    ///
    /// # Errors
    ///
    /// [`StageError::Io`] when `root` cannot be made a directory.
    pub fn at(root: impl Into<PathBuf>, cache: Box<dyn Cache>) -> Result<Self, StageError> {
        let root = root.into();
        fs::create_dir_all(&root).map_err(|source| StageError::io(&root, &source))?;
        Ok(Self { root, cache })
    }

    /// The system path a file inside the run is at.
    #[must_use]
    pub fn path(&self, relative: &str) -> PathBuf {
        self.root.join(relative)
    }

    /// Creates an empty file the run is handed, opened for writing.
    ///
    /// # Errors
    ///
    /// [`StageError::AlreadyExists`] when the run already has a file at the
    /// path, and [`StageError::Io`] when the file cannot be created or given
    /// its mode.
    pub fn create(&self, relative: &str, executable: bool) -> Result<File, StageError> {
        let path = self.path(relative);
        let mut exclusive = OpenOptions::new();
        exclusive.write(true).create_new(true);
        let file = match exclusive.open(&path) {
            Ok(file) => file,
            Err(source) => return Err(exclusive_creation(&path, &source)),
        };
        let mode = if executable {
            MODE_EXECUTABLE
        } else {
            MODE_PLAIN
        };
        let given = fs::set_permissions(&path, Permissions::from_mode(mode));
        given.map_err(|source| StageError::io(&path, &source))?;
        Ok(file)
    }

    /// Writes content to a file the run is handed, creating the file.
    ///
    /// # Errors
    ///
    /// Whatever [`create`](Self::create) refuses with, and
    /// [`StageError::Io`] when the content cannot be written.
    pub fn write(
        &self,
        relative: &str,
        content: &[u8],
        executable: bool,
    ) -> Result<(), StageError> {
        let mut file = self.create(relative, executable)?;
        file.write_all(content)
            .map_err(|source| StageError::io(self.path(relative), &source))
    }

    /// Writes a stored file into the stage, creating the file for it.
    ///
    /// The content is fetched before the file is created, so a digest the
    /// store refuses leaves the run no empty file where its file should be.
    ///
    /// # Errors
    ///
    /// Whatever the store refuses with for the content, then whatever
    /// [`create`](Self::create) refuses with.
    pub fn write_from_storage(
        &self,
        relative: &str,
        handle: &CacheHandle,
        executable: bool,
    ) -> Result<(), StageError> {
        let content = self.cache.get_file(handle)?;
        self.write(relative, &content, executable)
    }

    /// Reads a staged file, whole or only as far as `limit` reaches.
    ///
    /// A limit is a bound on the answer and not on the file, so a run whose
    /// output is large costs no more to read than the caller will look at.
    ///
    /// # Errors
    ///
    /// [`StageError::Io`] when the file cannot be opened or read.
    pub fn read(&self, relative: &str, limit: Option<usize>) -> Result<Vec<u8>, StageError> {
        let path = self.path(relative);
        let mut file = File::open(&path).map_err(|source| StageError::io(&path, &source))?;
        let mut content = Vec::new();
        let read = match limit {
            Some(limit) => file.take(limit as u64).read_to_end(&mut content),
            None => file.read_to_end(&mut content),
        };
        read.map_err(|source| StageError::io(&path, &source))?;
        Ok(content)
    }

    /// Stores a staged file and answers the digest it is stored under.
    ///
    /// The digest is a SHA-1 over the content, which is what the `DIGEST` domain
    /// admits and what every file already in the store is named by.
    ///
    /// # Errors
    ///
    /// [`StageError::Io`] when the file cannot be read, then whatever the
    /// store refuses with. A SHA-1 is always forty lowercase hexadecimal
    /// digits, so [`StageError::Digest`] reports a hasher that is not one
    /// rather than content the domain would refuse.
    pub fn store(&self, relative: &str) -> Result<FileDigest, StageError> {
        let content = self.read(relative, None)?;
        let digest = digest_of(&content)?;
        self.cache.put_file(&digest, &content)?;
        Ok(digest)
    }
}

/// The digest a file's content is stored and addressed under.
fn digest_of(content: &[u8]) -> Result<FileDigest, StageError> {
    FileDigest::from_str(&hexadecimal(&Sha1::digest(content))).map_err(StageError::Digest)
}

/// The hexadecimal form hashed bytes are addressed by, two characters to a byte.
fn hexadecimal(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    let mut form = String::with_capacity(DIGEST_HEX_LEN);
    for byte in bytes {
        write!(form, "{byte:02x}").expect("writing into a String cannot fail");
    }
    form
}

/// What an exclusive create refuses: a path the run already has, or the
/// failure the file system gave.
fn exclusive_creation(path: &Path, source: &std::io::Error) -> StageError {
    if source.kind() == std::io::ErrorKind::AlreadyExists {
        return StageError::AlreadyExists {
            path: path.to_path_buf(),
        };
    }
    StageError::io(path, source)
}
