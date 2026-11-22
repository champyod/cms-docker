//! What a cache does about a file it holds: read it, store it once, evict it.
//!
//! WHY no database: none of these properties needs one. The directory backend keeps
//! the same promises the database one does, so the suite runs everywhere; the
//! database backend's half is `filecache_durability` and `filecache_dedup`.

use std::fs;
use std::path::Path;

use cms_db::{Backend, CacheError, CacheHandle, FileCacheError};

#[path = "support/cache.rs"]
mod cache;

#[path = "support/scratch.rs"]
mod scratch;

use cache::{cache_at, handle};
use scratch::Scratch;

fn stored_files(directory: &Path) -> Vec<String> {
    fs::read_dir(directory)
        .expect("reading the backend directory")
        .map(|entry| {
            entry
                .expect("reading an entry")
                .file_name()
                .to_string_lossy()
                .into_owned()
        })
        .collect()
}

#[test]
fn a_file_one_cacher_stored_is_readable_by_a_fresh_one() {
    let scratch = Scratch::new();
    let store = scratch.path("store");
    let first = cache_at(
        &scratch,
        "first",
        Backend::file_system(&store).expect("backend"),
    );
    let digest =
        sqlx::test_block_on(first.put_content(b"shared bytes", "a fixture")).expect("storing");

    // The second cache's directory is empty, so the content can only come from the backend.
    let second = cache_at(
        &scratch,
        "second",
        Backend::file_system(&store).expect("backend"),
    );
    assert!(!second.file_dir().join(digest.as_str()).exists());

    assert_eq!(
        sqlx::test_block_on(second.get_content(&handle(&digest))).expect("reading"),
        b"shared bytes"
    );
    assert_eq!(
        sqlx::test_block_on(second.describe(&handle(&digest))).expect("describing"),
        None,
        "a directory backend keeps no description"
    );
    assert_eq!(
        sqlx::test_block_on(second.get_size(&handle(&digest))).expect("sizing"),
        12
    );
}

#[test]
fn the_same_digest_is_stored_once() {
    let scratch = Scratch::new();
    let store = scratch.path("store");
    let cache = cache_at(
        &scratch,
        "once",
        Backend::file_system(&store).expect("backend"),
    );

    let first = sqlx::test_block_on(cache.put_content(b"same bytes", "first")).expect("first put");
    let second =
        sqlx::test_block_on(cache.put_content(b"same bytes", "second")).expect("second put");

    assert_eq!(first, second, "identical content has one digest");
    assert_eq!(
        stored_files(&store),
        vec![first.as_str().to_owned()],
        "the backend holds the file once"
    );
}

#[test]
fn an_evicted_entry_is_fetched_again_instead_of_served_stale() {
    let scratch = Scratch::new();
    let store = scratch.path("store");
    let cache = cache_at(
        &scratch,
        "evict",
        Backend::file_system(&store).expect("backend"),
    );

    let digest = sqlx::test_block_on(cache.put_content(b"cache me", "")).expect("storing");
    let cached = cache.file_dir().join(digest.as_str());
    assert!(cached.exists(), "the put must leave the file in the cache");

    cache.drop_cached(&handle(&digest)).expect("evicting");
    assert!(!cached.exists(), "the eviction must remove the file");

    let content = sqlx::test_block_on(cache.get_content(&handle(&digest))).expect("re-reading");
    assert_eq!(content, b"cache me");
    assert!(cached.exists(), "the read must have refilled the cache");

    // With the backend's copy gone as well, the cache must not serve the stale one.
    sqlx::test_block_on(cache.delete(&handle(&digest))).expect("deleting");
    let error = sqlx::test_block_on(cache.get_content(&handle(&digest)))
        .expect_err("a deleted file must not be served from the cache");
    assert!(
        matches!(error, FileCacheError::Missing(ref found) if *found == digest),
        "expected the backend's miss, got {error}"
    );
}

#[test]
fn a_null_backend_keeps_what_the_cache_holds_and_nothing_else() {
    let scratch = Scratch::new();
    let cache = cache_at(&scratch, "null", Backend::null());
    let digest = sqlx::test_block_on(cache.put_content(b"local only", "")).expect("storing");
    assert_eq!(
        sqlx::test_block_on(cache.get_content(&handle(&digest))).expect("reading"),
        b"local only"
    );

    let fresh = cache_at(&scratch, "null-fresh", Backend::null());
    let error = sqlx::test_block_on(fresh.get_content(&handle(&digest)))
        .expect_err("a null backend stores nothing for a second cache to read");
    assert!(
        matches!(error, FileCacheError::Missing(ref found) if *found == digest),
        "expected a miss, got {error}"
    );
}

#[test]
fn the_tombstone_is_refused_rather_than_looked_up() {
    let scratch = Scratch::new();
    let cache = cache_at(&scratch, "tombstone", Backend::null());
    let tombstone = CacheHandle::new(cms_db::FileDigest::tombstone());

    assert!(
        matches!(
            sqlx::test_block_on(cache.get_content(&tombstone)),
            Err(FileCacheError::Tombstone(CacheError::Tombstone))
        ),
        "the tombstone must be refused before the backend is asked"
    );
    assert!(matches!(
        sqlx::test_block_on(cache.describe(&tombstone)),
        Err(FileCacheError::Tombstone(CacheError::Tombstone))
    ));
    cache.drop_cached(&tombstone).expect("dropping a tombstone");
    sqlx::test_block_on(cache.delete(&tombstone)).expect("deleting a tombstone");
}
