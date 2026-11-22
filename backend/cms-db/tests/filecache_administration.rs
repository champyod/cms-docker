//! What a cache does about itself: lock, close, check, purge, destroy.
//!
//! The shutdown and the lock are the two pieces of `atexit` and `flock` the
//! reference relied on, so they are checked rather than assumed: a private
//! directory goes, a shared one stays, and only one precacher holds the lock.

use std::fs;

use cms_db::{Backend, CacheScope, FileCache, FileCacheConfig, FileCacheError};

#[path = "support/cache.rs"]
mod cache;

#[path = "support/scratch.rs"]
mod scratch;

use cache::{cache_at, handle};
use scratch::Scratch;

#[test]
fn only_one_precacher_takes_the_lock() {
    let scratch = Scratch::new();
    let cache = cache_at(&scratch, "lock", Backend::null());
    let held = cache
        .precache_lock()
        .expect("locking")
        .expect("a free lock");
    assert!(cache.precache_lock().expect("locking again").is_none());
    drop(held);
    assert!(cache.precache_lock().expect("after the release").is_some());
}

#[test]
fn closing_removes_a_private_cache_and_keeps_a_shared_one() {
    let scratch = Scratch::new();
    let private = cache_at(&scratch, "private", Backend::null());
    let private_dir = private.file_dir().to_owned();
    private.close().expect("closing the private cache");
    assert!(!private_dir.exists());

    let shared = FileCache::open(FileCacheConfig {
        backend: Backend::null(),
        temp_root: scratch.path("shared-temp"),
        cache_root: scratch.path("shared-cache"),
        scope: CacheScope::Shared,
    })
    .expect("opening the shared cache");
    let shared_dir = shared.file_dir().to_owned();
    shared.close().expect("closing the shared cache");
    assert!(shared_dir.exists(), "a shared directory outlives its cache");
}

#[test]
fn a_backend_file_whose_bytes_changed_fails_the_integrity_check() {
    let scratch = Scratch::new();
    let store = scratch.path("store");
    let cache = cache_at(
        &scratch,
        "integrity",
        Backend::file_system(&store).expect("backend"),
    );
    let digest = sqlx::test_block_on(cache.put_content(b"untouched", "")).expect("storing");
    assert!(sqlx::test_block_on(cache.check_integrity(false)).expect("checking"));

    // Same name, different bytes: the file no longer is what it says it is.
    fs::write(store.join(digest.as_str()), b"tampered").expect("corrupting the backend file");
    assert!(!sqlx::test_block_on(cache.check_integrity(false)).expect("checking"));
    assert!(store.join(digest.as_str()).exists());

    assert!(!sqlx::test_block_on(cache.check_integrity(true)).expect("checking"));
    assert!(
        !store.join(digest.as_str()).exists(),
        "the repair must delete the file it could not trust"
    );
}

#[test]
fn purging_empties_the_cache_and_leaves_it_usable() {
    let scratch = Scratch::new();
    let store = scratch.path("store");
    let mut cache = cache_at(
        &scratch,
        "purge",
        Backend::file_system(&store).expect("backend"),
    );
    let digest = sqlx::test_block_on(cache.put_content(b"purge me", "")).expect("storing");
    assert!(cache.file_dir().join(digest.as_str()).exists());

    cache.purge().expect("purging");
    assert!(!cache.file_dir().join(digest.as_str()).exists());
    assert!(
        cache.temp_dir().exists(),
        "a purged cache still needs somewhere to download into"
    );

    assert_eq!(
        sqlx::test_block_on(cache.get_content(&handle(&digest))).expect("re-reading"),
        b"purge me"
    );
}

#[test]
fn a_shared_cache_refuses_to_be_destroyed() {
    let scratch = Scratch::new();
    let shared = FileCache::open(FileCacheConfig {
        backend: Backend::null(),
        temp_root: scratch.path("shared-temp"),
        cache_root: scratch.path("shared-cache"),
        scope: CacheScope::Shared,
    })
    .expect("opening the shared cache");
    assert!(shared.is_shared());
    assert!(matches!(shared.destroy(), Err(FileCacheError::Shared)));
}
