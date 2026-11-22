//! The cache in front of PostgreSQL: a second cacher reads what the first stored,
//! one digest is one row, and an evicted entry is fetched again.
//!
//! WHY live: the properties are about what survives between connections, and only a
//! server keeps the row and the large object that make them true.
//!
//! RUN: CMS_DB_TEST_URL=postgres://cmsuser:***@127.0.0.1:5432/cmsdb_test \
//!        cargo test -p cms-db --test filecache_durability

use cms_db::{
    Backend, CacheHandle, CacheScope, FileCache, FileCacheConfig, FileCacheError, FileDigest,
    SessionConfig,
};
use sqlx::postgres::PgConnection;
use sqlx::Connection;

mod support;

#[path = "support/scratch.rs"]
mod scratch;

use scratch::Scratch;

const URL_ENV: &str = "CMS_DB_TEST_URL";

/// Content of each test's own, so the tests can run at once against one table.
const FRESH: &[u8] = b"read by a fresh cacher";
const ONCE: &[u8] = b"stored exactly once";
const EVICTED: &[u8] = b"evicted and fetched again";

fn skip() -> Option<SessionConfig> {
    let config = std::env::var(URL_ENV)
        .ok()
        .filter(|url| !url.trim().is_empty())
        .map(SessionConfig::new);
    if config.is_none() {
        eprintln!("SKIP: set {URL_ENV} to a scratch database to run the live half");
    }
    config
}

fn cache_at(scratch: &Scratch, name: &str, config: &SessionConfig) -> FileCache {
    FileCache::open(FileCacheConfig {
        backend: Backend::database(config.clone()),
        temp_root: scratch.path(&format!("{name}-temp")),
        cache_root: scratch.path(&format!("{name}-cache")),
        scope: CacheScope::Private,
    })
    .expect("opening the cache")
}

fn handle(digest: &FileDigest) -> CacheHandle {
    CacheHandle::new(digest.clone())
}

async fn connection(config: &SessionConfig) -> PgConnection {
    PgConnection::connect_with(&config.connect_options().expect("reading the test URL"))
        .await
        .expect("connecting to the test database")
}

async fn count_rows(config: &SessionConfig, digest: &FileDigest) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM fsobjects WHERE digest = $1::varchar")
        .bind(digest.as_str())
        .fetch_one(&mut connection(config).await)
        .await
        .expect("counting the rows")
}

#[test]
fn a_file_one_cacher_stored_is_readable_by_a_fresh_one() {
    let Some(config) = skip() else { return };
    let scratch = Scratch::new();
    sqlx::test_block_on(async {
        let mut setup = connection(&config).await;
        support::create(&mut setup).await;
        let digest: FileDigest = cms_db::bytes_digest(FRESH).parse().expect("a digest");
        sqlx::query("DELETE FROM fsobjects WHERE digest = $1::varchar")
            .bind(digest.as_str())
            .execute(&mut setup)
            .await
            .expect("clearing a previous run");

        let first = cache_at(&scratch, "first", &config);
        assert_eq!(
            first
                .put_content(FRESH, "a fixture")
                .await
                .expect("storing"),
            digest
        );
        assert_eq!(count_rows(&config, &digest).await, 1);

        // The second cache's directories are empty, so the bytes can only come from the row.
        let second = cache_at(&scratch, "second", &config);
        assert!(!second.file_dir().join(digest.as_str()).exists());
        assert_eq!(
            second.get_content(&handle(&digest)).await.expect("reading"),
            FRESH
        );
        assert_eq!(
            second.describe(&handle(&digest)).await.expect("describing"),
            Some("a fixture".to_owned())
        );
        assert_eq!(
            second.get_size(&handle(&digest)).await.expect("sizing"),
            FRESH.len() as u64
        );
    });
}

#[test]
fn the_same_digest_is_stored_once() {
    let Some(config) = skip() else { return };
    let scratch = Scratch::new();
    sqlx::test_block_on(async {
        let mut setup = connection(&config).await;
        support::create(&mut setup).await;
        let digest: FileDigest = cms_db::bytes_digest(ONCE).parse().expect("a digest");
        sqlx::query("DELETE FROM fsobjects WHERE digest = $1::varchar")
            .bind(digest.as_str())
            .execute(&mut setup)
            .await
            .expect("clearing a previous run");

        let cache = cache_at(&scratch, "once", &config);
        assert_eq!(
            cache.put_content(ONCE, "first").await.expect("first put"),
            digest
        );
        assert_eq!(
            cache.put_content(ONCE, "second").await.expect("second put"),
            digest
        );

        assert_eq!(count_rows(&config, &digest).await, 1);
        assert_eq!(
            cache.describe(&handle(&digest)).await.expect("describing"),
            Some("first".to_owned()),
            "the second put replaced the row instead of being deduplicated"
        );
    });
}

#[test]
fn an_evicted_entry_is_fetched_again_instead_of_served_stale() {
    let Some(config) = skip() else { return };
    let scratch = Scratch::new();
    sqlx::test_block_on(async {
        let mut setup = connection(&config).await;
        support::create(&mut setup).await;
        let digest: FileDigest = cms_db::bytes_digest(EVICTED).parse().expect("a digest");
        sqlx::query("DELETE FROM fsobjects WHERE digest = $1::varchar")
            .bind(digest.as_str())
            .execute(&mut setup)
            .await
            .expect("clearing a previous run");

        let cache = cache_at(&scratch, "evict", &config);
        cache.put_content(EVICTED, "").await.expect("storing");
        let cached = cache.file_dir().join(digest.as_str());
        assert!(cached.exists(), "the put must leave the file in the cache");

        cache.drop_cached(&handle(&digest)).expect("evicting");
        assert!(!cached.exists(), "the eviction must remove the file");
        assert_eq!(
            cache
                .get_content(&handle(&digest))
                .await
                .expect("re-reading"),
            EVICTED
        );
        assert!(cached.exists(), "the read must have refilled the cache");

        // With the backend's copy gone, the cache must not serve the one it holds.
        cache.delete(&handle(&digest)).await.expect("deleting");
        assert!(!cached.exists());
        assert_eq!(count_rows(&config, &digest).await, 0);
        let error = cache
            .get_content(&handle(&digest))
            .await
            .expect_err("a deleted file must not be served from the cache");
        assert!(
            matches!(error, FileCacheError::Missing(ref found) if *found == digest),
            "expected the backend's miss, got {error}"
        );
    });
}
