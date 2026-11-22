//! A backend that keeps each file in a directory, named after its digest.
//!
//! The directory can be shared over NFS, which is what made it the answer for a
//! cluster with no database storage to spare; the digest is the file's only name
//! there, so nothing but the bytes is kept and a description is always absent,
//! the gap the reference's own TODO admitted.

use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};

use crate::digest::FileDigest;

use super::super::store::{Readable, Writable};
use super::super::FileCacheError;
use super::super::{naming, remove_file};
use super::StoredFile;

/// Marks a file a put did not finish moving into place.
const TEMPORARY_PREFIX: &str = ".tmp.";

/// A directory of files named by digest.
pub struct FsBackend {
    path: PathBuf,
}

impl FsBackend {
    /// A backend rooted at `path`, created when it does not exist.
    ///
    /// # Errors
    ///
    /// [`FileCacheError::Directory`] when the directory cannot be created.
    pub fn new(path: impl Into<PathBuf>) -> Result<Self, FileCacheError> {
        let path = path.into();
        fs::create_dir_all(&path).map_err(|source| FileCacheError::directory(&path, source))?;
        Ok(Self { path })
    }

    /// The directory this backend stores in.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    fn file_path(&self, digest: &FileDigest) -> PathBuf {
        self.path.join(digest.as_str())
    }

    /// Open the file stored under `digest`.
    ///
    /// # Errors
    ///
    /// [`FileCacheError::Missing`] when the directory holds no such file, and
    /// [`FileCacheError::Io`] for anything else the open reports.
    pub async fn get_file(&self, digest: &FileDigest) -> Result<Readable, FileCacheError> {
        let path = self.file_path(digest);
        match File::open(&path) {
            Ok(file) => Ok(Readable::File { file, path }),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                Err(FileCacheError::Missing(digest.clone()))
            }
            Err(source) => Err(FileCacheError::io(path, source)),
        }
    }

    /// Open a temporary file that will be renamed into place by the commit.
    ///
    /// # Errors
    ///
    /// [`FileCacheError::Io`] when the temporary file cannot be created.
    pub async fn create_file(
        &self,
        digest: &FileDigest,
    ) -> Result<Option<Writable>, FileCacheError> {
        if self.file_path(digest).exists() {
            return Ok(None);
        }
        let (file, path) = naming::create_file(&self.path, TEMPORARY_PREFIX, digest.as_str())
            .map_err(|source| FileCacheError::io(&self.path, source))?;
        Ok(Some(Writable::File { file, path }))
    }

    /// Rename the temporary file into place, or drop it when the digest is taken.
    ///
    /// The check and the rename are two steps, and another writer can land between
    /// them: the rename then replaces a file that holds the same bytes, which is
    /// why the reference left the race alone.
    ///
    /// # Errors
    ///
    /// [`FileCacheError::ForeignWriter`] for a writer another backend made, and
    /// [`FileCacheError::Io`] when the move fails.
    pub async fn commit(
        &self,
        writer: Writable,
        digest: &FileDigest,
        _description: &str,
    ) -> Result<bool, FileCacheError> {
        let Writable::File {
            file,
            path: temporary,
        } = writer
        else {
            return Err(FileCacheError::ForeignWriter);
        };
        drop(file);

        let target = self.file_path(digest);
        if target.exists() {
            remove_file(&temporary)?;
            return Ok(false);
        }
        fs::rename(&temporary, &target).map_err(|source| FileCacheError::io(&temporary, source))?;
        Ok(true)
    }

    /// A description, which this backend does not keep.
    ///
    /// # Errors
    ///
    /// [`FileCacheError::Missing`] when the directory holds no such file.
    pub async fn describe(&self, digest: &FileDigest) -> Result<Option<String>, FileCacheError> {
        self.require(digest).await?;
        Ok(None)
    }

    /// The file's size on disk.
    ///
    /// # Errors
    ///
    /// [`FileCacheError::Missing`] when the directory holds no such file, and
    /// [`FileCacheError::Io`] when it cannot be measured.
    pub async fn get_size(&self, digest: &FileDigest) -> Result<u64, FileCacheError> {
        let path = self.file_path(digest);
        match fs::metadata(&path) {
            Ok(metadata) => Ok(metadata.len()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                Err(FileCacheError::Missing(digest.clone()))
            }
            Err(source) => Err(FileCacheError::io(path, source)),
        }
    }

    /// Remove the file, treating an already-absent one as removed.
    ///
    /// # Errors
    ///
    /// [`FileCacheError::Io`] when the removal fails for any other reason, which
    /// the reference's bare `except OSError` would have hidden.
    pub async fn delete(&self, digest: &FileDigest) -> Result<(), FileCacheError> {
        super::super::remove_file(&self.file_path(digest))
    }

    /// Every entry whose name is a digest.
    ///
    /// Only parseable names count: a temporary file a crashed put left behind is
    /// not a stored file, and the reference's `listdir` reported it as one.
    ///
    /// # Errors
    ///
    /// [`FileCacheError::Io`] when the directory cannot be read.
    pub async fn list(&self) -> Result<Vec<StoredFile>, FileCacheError> {
        let entries =
            fs::read_dir(&self.path).map_err(|source| FileCacheError::io(&self.path, source))?;
        let mut files = Vec::new();
        for entry in entries {
            let entry = entry.map_err(|source| FileCacheError::io(&self.path, source))?;
            let name = entry.file_name();
            let Some(digest) = name.to_str().and_then(|name| name.parse().ok()) else {
                continue;
            };
            files.push(StoredFile {
                digest,
                description: None,
            });
        }
        Ok(files)
    }

    async fn require(&self, digest: &FileDigest) -> Result<(), FileCacheError> {
        if self.file_path(digest).exists() {
            Ok(())
        } else {
            Err(FileCacheError::Missing(digest.clone()))
        }
    }
}
