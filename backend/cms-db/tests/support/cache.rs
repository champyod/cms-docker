//! The cache a test opens over one backend.

use cms_db::{Backend, CacheHandle, CacheScope, FileCache, FileCacheConfig, FileDigest};

use crate::scratch::Scratch;

/// A private cache over `backend`, with its roots inside `scratch`.
pub fn cache_at(scratch: &Scratch, name: &str, backend: Backend) -> FileCache {
    FileCache::open(FileCacheConfig {
        backend,
        temp_root: scratch.path(&format!("{name}-temp")),
        cache_root: scratch.path(&format!("{name}-cache")),
        scope: CacheScope::Private,
    })
    .expect("opening the cache")
}

/// The handle a read or a removal is made with.
pub fn handle(digest: &FileDigest) -> CacheHandle {
    CacheHandle::new(digest.clone())
}
