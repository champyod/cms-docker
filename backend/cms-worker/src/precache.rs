//! Database-backed contest precaching.
//!
//! `cms.service.Worker.precache_files` is the reference. It takes the shared
//! cache's lock, steps aside when another worker holds it, reads the contest's
//! digests, and asks `FileCacher` to fetch each one, passing over a file that is
//! not there because a missing file is no problem at this stage.
//!
//! The synchronous digest walk in `cms_grading` stays unused on this path: its
//! cache trait only reads a local store, while the reference's `FileCacher`
//! fetches missing bytes through its database backend.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::collections::BTreeSet;
use std::fmt;
use std::path::PathBuf;

use cms_db::{
    enumerate_files, get_contest_list, Backend, CacheHandle, CacheScope, FileCache,
    FileCacheConfig, FileCacheError, FileDigest, FileSkips, Session, SessionConfig,
};

/// One worker's database-backed precache over the shared file cache.
pub struct Precache {
    database_url: String,
    file_cache: FileCache,
}

impl Precache {
    /// Opens a shared file cache whose misses are fetched from `database_url`.
    ///
    /// # Errors
    ///
    /// Returns [`FileCacheError`] when a cache directory cannot be created.
    pub fn new(
        database_url: impl Into<String>,
        temp_root: PathBuf,
        cache_root: PathBuf,
    ) -> Result<Self, FileCacheError> {
        let database_url = database_url.into();
        let file_cache = FileCache::open(FileCacheConfig {
            backend: Backend::database(SessionConfig::new(database_url.clone())),
            temp_root,
            cache_root,
            scope: CacheScope::Shared,
        })?;
        Ok(Self {
            database_url,
            file_cache,
        })
    }

    /// Precaches one contest, or steps aside when another worker holds the lock.
    ///
    /// # Errors
    ///
    /// Returns the database or cache refusal as an RPC sentence. A file absent
    /// from the backend is passed over, as the reference passes over `KeyError`.
    pub fn run(&self, contest_id: i32) -> Result<Option<()>, String> {
        let Some(_lock) = self
            .file_cache
            .precache_lock()
            .map_err(|error| format!("precache_files() could not take the cache lock: {error}"))?
        else {
            return Ok(None);
        };
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|error| format!("precache_files() could not start its runtime: {error}"))?;
        runtime.block_on(self.precache(contest_id))?;
        Ok(Some(()))
    }

    async fn precache(&self, contest_id: i32) -> Result<(), String> {
        let files = load_files(&self.database_url, contest_id).await?;
        cache_files(&self.file_cache, &files).await
    }

    /// The shared cache an RPC test holds the precache lock on.
    #[cfg(test)]
    pub(crate) fn file_cache(&self) -> &FileCache {
        &self.file_cache
    }
}

impl fmt::Debug for Precache {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.debug_struct("Precache").finish_non_exhaustive()
    }
}

/// Reads the contest's digests in one short transaction, then rolls it back.
async fn load_files(database_url: &str, contest_id: i32) -> Result<BTreeSet<FileDigest>, String> {
    let config = SessionConfig::new(database_url);
    let session = Session::open(&config)
        .await
        .map_err(|error| format!("precache_files() could not open the database: {error}"))?;
    let mut transaction = session
        .begin()
        .await
        .map_err(|error| format!("precache_files() could not begin its transaction: {error}"))?;
    let files = async {
        let contests = get_contest_list(transaction.connection())
            .await
            .map_err(|error| format!("precache_files() could not read contests: {error}"))?;
        let contest = contests
            .into_iter()
            .find(|contest| contest.id == contest_id)
            .ok_or_else(|| {
                format!("precache_files() found no contest with `contest_id` {contest_id}")
            })?;
        enumerate_files(
            transaction.connection(),
            Some(&contest),
            FileSkips {
                submissions: true,
                user_tests: true,
                users: false,
                generated: false,
            },
        )
        .await
        .map_err(|error| format!("precache_files() could not enumerate files: {error}"))
    }
    .await;
    transaction.rollback().await.map_err(|error| {
        format!("precache_files() could not roll back its transaction: {error}")
    })?;
    files
}

/// Fetches every digest, passing over a file the backend does not hold.
async fn cache_files(file_cache: &FileCache, files: &BTreeSet<FileDigest>) -> Result<(), String> {
    for digest in files {
        match file_cache.cache(&CacheHandle::new(digest.clone())).await {
            Ok(()) | Err(FileCacheError::Missing(_)) => {}
            Err(error) => {
                return Err(format!(
                    "precache_files() could not cache digest {}: {error}",
                    digest.as_str()
                ));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;
    use std::fs;
    use std::path::PathBuf;

    use cms_db::{Backend, CacheScope, FileCache, FileCacheConfig, FileDigest};

    use super::{cache_files, Precache};

    fn workspace(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("cms-worker-precache-{name}-{}", std::process::id()));
        match fs::remove_dir_all(&dir) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => panic!("the test's old directory must be removable: {error}"),
        }
        fs::create_dir_all(&dir).expect("the test's directory must be creatable");
        dir
    }

    fn runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread()
            .build()
            .expect("a current-thread runtime can be built")
    }

    #[test]
    fn a_held_lock_steps_aside_before_the_database_is_opened() {
        let dir = workspace("lock");
        let precache = Precache::new("not-a-database-url", dir.join("tmp"), dir.join("cache"))
            .expect("a shared cache can be opened without connecting");
        assert!(precache.file_cache.is_shared());
        assert_eq!(
            precache.file_cache.file_dir(),
            dir.join("cache").join("fs-cache-shared")
        );
        let held = precache
            .file_cache
            .precache_lock()
            .expect("the lock file can be opened")
            .expect("the first lock is taken");

        assert_eq!(precache.run(7), Ok(None));

        drop(held);
        let refusal = precache
            .run(7)
            .expect_err("an unlocked walk reaches the unusable database URL");
        assert!(refusal.contains("not-a-database-url"), "{refusal}");
    }

    #[test]
    fn missing_files_are_passed_over_so_later_files_are_still_cached() {
        let dir = workspace("missing");
        let cache = FileCache::open(FileCacheConfig {
            backend: Backend::null(),
            temp_root: dir.join("tmp"),
            cache_root: dir.join("cache"),
            scope: CacheScope::Shared,
        })
        .expect("a cache directory can be opened");
        let missing: FileDigest = "0000000000000000000000000000000000000000"
            .parse()
            .expect("a digest");
        let cached: FileDigest = "1111111111111111111111111111111111111111"
            .parse()
            .expect("a digest");
        fs::write(cache.file_dir().join(cached.as_str()), b"already cached")
            .expect("the cached file can be written");
        let files = BTreeSet::from([missing.clone(), cached.clone()]);

        runtime()
            .block_on(cache_files(&cache, &files))
            .expect("a missing file does not stop the walk");

        assert!(!cache.file_dir().join(missing.as_str()).exists());
        assert_eq!(
            fs::read(cache.file_dir().join(cached.as_str())).expect("the cached file remains"),
            b"already cached"
        );
    }
}
