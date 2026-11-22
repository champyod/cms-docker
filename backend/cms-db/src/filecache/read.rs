//! Reading a file, through the cache when it is there and the backend when it is not.
//!
//! The cache file is opened before the download is renamed into place, which is the
//! reference's answer to a race it documented: any process may delete a cache file
//! at any moment, and an open handle survives that while a name does not.

use std::fs::{self, File};
use std::io;
use std::path::Path;

use crate::digest::{CacheHandle, FileDigest};

use super::store::{copy_to_file, Readable};
use super::{naming, CHUNK_SIZE};
use super::{FileCache, FileCacheError};

impl FileCache {
    /// Bring a file into the cache without returning it.
    ///
    /// # Errors
    ///
    /// [`FileCacheError::Tombstone`] for the tombstone, and
    /// [`FileCacheError::Missing`] when the backend holds no such file.
    pub async fn cache(&self, handle: &CacheHandle) -> Result<(), FileCacheError> {
        let digest = handle.open()?;
        if self.cache_path(digest).exists() {
            return Ok(());
        }
        self.download(digest).await?;
        Ok(())
    }

    /// A readable stream holding the file.
    ///
    /// # Errors
    ///
    /// [`FileCacheError::Tombstone`] for the tombstone, and
    /// [`FileCacheError::Missing`] when neither the cache nor the backend has it.
    pub async fn get_file(&self, handle: &CacheHandle) -> Result<Readable, FileCacheError> {
        let digest = handle.open()?;
        let path = self.cache_path(digest);
        match File::open(&path) {
            Ok(file) => return Ok(Readable::File { file, path }),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(source) => return Err(FileCacheError::io(path, source)),
        }
        self.download(digest).await
    }

    /// The file's content.
    ///
    /// # Errors
    ///
    /// Whatever [`get_file`](Self::get_file) reports, plus
    /// [`FileCacheError::Io`] when a read fails.
    pub async fn get_content(&self, handle: &CacheHandle) -> Result<Vec<u8>, FileCacheError> {
        let mut source = self.get_file(handle).await?;
        let mut content = Vec::new();
        let mut buffer = vec![0_u8; CHUNK_SIZE];
        loop {
            let read = source.read(&mut buffer).await?;
            if read == 0 {
                return Ok(content);
            }
            content.extend_from_slice(&buffer[..read]);
        }
    }

    /// Write the file's content to `path`, replacing what was there.
    ///
    /// # Errors
    ///
    /// Whatever [`get_file`](Self::get_file) reports, plus
    /// [`FileCacheError::Io`] when the destination cannot be written.
    pub async fn get_to_path(
        &self,
        handle: &CacheHandle,
        path: &Path,
    ) -> Result<(), FileCacheError> {
        let mut source = self.get_file(handle).await?;
        let mut destination =
            File::create(path).map_err(|error| FileCacheError::io(path, error))?;
        copy_to_file(&mut source, &mut destination, path, CHUNK_SIZE).await?;
        Ok(())
    }

    /// Fetch a file from the backend, cache it, and open it.
    ///
    /// # Errors
    ///
    /// [`FileCacheError::Missing`] when the backend holds no such file, and
    /// [`FileCacheError::Io`] when the temporary file or the rename fails.
    async fn download(&self, digest: &FileDigest) -> Result<Readable, FileCacheError> {
        let (mut temporary, path) = naming::create_file(&self.temp_dir, "", "")
            .map_err(|source| FileCacheError::io(&self.temp_dir, source))?;
        {
            let mut source = self.backend.get_file(digest).await?;
            copy_to_file(&mut source, &mut temporary, &path, CHUNK_SIZE).await?;
        }
        drop(temporary);

        let target = self.cache_path(digest);
        let opened = File::open(&path).map_err(|source| FileCacheError::io(&path, source))?;
        fs::rename(&path, &target).map_err(|source| FileCacheError::io(&path, source))?;
        Ok(Readable::File {
            file: opened,
            path: target,
        })
    }
}
