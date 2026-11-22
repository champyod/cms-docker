//! Writing a file: digest it once on the way in, the cache and the backend both.
//!
//! The reference's comment explains why the content is written to a temporary file
//! before it goes to a backend: the digest has to be known before there is a name
//! to store the bytes under, the source may be compressed or arrive over a network
//! so it is not read twice, and the temporary file then only has to be renamed into
//! the cache.

use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::Path;

use crate::digest::{Digester, FileDigest};

use super::store::copy_to_writable;
use super::{naming, CHUNK_SIZE};
use super::{FileCache, FileCacheError};

impl FileCache {
    /// Store everything `source` holds, returning the digest it is filed under.
    ///
    /// The backend is asked to store it even when the cache already holds a copy,
    /// because the backend may have lost the file while the cache kept it.
    ///
    /// # Errors
    ///
    /// [`FileCacheError::Io`] when the temporary file cannot be written or renamed,
    /// and whatever the backend reports.
    pub async fn put(
        &self,
        source: &mut dyn Read,
        description: &str,
    ) -> Result<FileDigest, FileCacheError> {
        let (mut temporary, path) = naming::create_file(&self.temp_dir, "", "")
            .map_err(|error| FileCacheError::io(&self.temp_dir, error))?;
        let digest = digest_into(source, &mut temporary, &path)?;
        temporary
            .flush()
            .map_err(|error| FileCacheError::io(&path, error))?;
        drop(temporary);

        // Store it even when the cache holds a copy: the backend may have lost it.
        if let Some(mut writer) = self.backend.create_file(&digest).await? {
            let mut stored = File::open(&path).map_err(|error| FileCacheError::io(&path, error))?;
            copy_to_writable(&mut stored, &mut writer, &path, CHUNK_SIZE).await?;
            self.backend.commit(writer, &digest, description).await?;
        }

        let target = self.cache_path(&digest);
        fs::rename(&path, &target).map_err(|error| FileCacheError::io(&path, error))?;
        Ok(digest)
    }

    /// Store a file that is already in memory.
    ///
    /// # Errors
    ///
    /// Whatever [`put`](Self::put) reports.
    pub async fn put_content(
        &self,
        content: &[u8],
        description: &str,
    ) -> Result<FileDigest, FileCacheError> {
        self.put(&mut io::Cursor::new(content), description).await
    }

    /// Store the file at `path`.
    ///
    /// # Errors
    ///
    /// [`FileCacheError::Io`] when `path` cannot be opened, and whatever
    /// [`put`](Self::put) reports.
    pub async fn put_path(
        &self,
        path: &Path,
        description: &str,
    ) -> Result<FileDigest, FileCacheError> {
        let mut source = File::open(path).map_err(|error| FileCacheError::io(path, error))?;
        self.put(&mut source, description).await
    }
}

/// Copy `source` into `temporary`, hashing it on the way, and answer its digest.
///
/// A read failure is reported against the temporary file the bytes were headed
/// for, the only path this function was given.
fn digest_into(
    source: &mut dyn Read,
    temporary: &mut File,
    path: &Path,
) -> Result<FileDigest, FileCacheError> {
    let mut hasher = Digester::new();
    let mut buffer = vec![0_u8; CHUNK_SIZE];
    loop {
        let read = source
            .read(&mut buffer)
            .map_err(|error| FileCacheError::io(path, error))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        temporary
            .write_all(&buffer[..read])
            .map_err(|error| FileCacheError::io(path, error))?;
    }
    Ok(hasher.digest().parse()?)
}
