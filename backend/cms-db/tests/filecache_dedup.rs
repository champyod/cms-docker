//! The one race `DBBackend.commit_file` handled: a rival inserts the same digest
//! between the existence check and the insert.
//!
//! WHY live and alone in its own binary: the assertion that counts what the losing
//! writer left behind has to see the whole database, so nothing else may be writing
//! large objects while it runs. Cargo runs test binaries one at a time; this file
//! holds a single test, so the count is the test's own.
//!
//! RUN: CMS_DB_TEST_URL=postgres://cmsuser:***@127.0.0.1:5432/cmsdb_test \
//!        cargo test -p cms-db --test filecache_dedup

use cms_db::{bytes_digest, Backend, FSObject, FileDigest, SessionConfig, NO_LARGE_OBJECT};
use sqlx::postgres::PgConnection;
use sqlx::Connection;

mod support;

const URL_ENV: &str = "CMS_DB_TEST_URL";
const CONTENT: &[u8] = b"two writers, one digest";

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

async fn connection(config: &SessionConfig) -> PgConnection {
    PgConnection::connect_with(&config.connect_options().expect("reading the test URL"))
        .await
        .expect("connecting to the test database")
}

/// The large objects no row names, which is exactly what a losing writer leaves if
/// its bytes are not unlinked.
///
/// Scoped to objects created after `$1`, because the count is otherwise taken over
/// the whole database: an orphan left by an earlier failed run made this test fail
/// for a reason no code change could fix, and only a dropped database cleared it.
const ORPHANS_SQL: &str = "\
    SELECT count(*) FROM pg_largeobject_metadata AS m \
    WHERE m.oid::bigint > $1 \
    AND NOT EXISTS (SELECT 1 FROM fsobjects AS f WHERE f.loid = m.oid)";

/// The highest object id before this test creates any, so [`ORPHANS_SQL`] can ignore
/// what was already there.
const ORPHAN_FLOOR_SQL: &str = "SELECT COALESCE(max(oid), 0)::bigint FROM pg_largeobject_metadata";

#[test]
fn a_competing_insert_leaves_one_row_and_no_unlinked_bytes() {
    let Some(config) = skip() else { return };
    sqlx::test_block_on(async {
        let mut setup = connection(&config).await;
        support::create(&mut setup).await;
        let orphan_floor: i64 = sqlx::query_scalar(ORPHAN_FLOOR_SQL)
            .fetch_one(&mut setup)
            .await
            .expect("reading the object id floor");
        let digest: FileDigest = bytes_digest(CONTENT).parse().expect("a digest");
        sqlx::query("DELETE FROM fsobjects WHERE digest = $1::varchar")
            .bind(digest.as_str())
            .execute(&mut setup)
            .await
            .expect("clearing a previous run");

        // A writer that passed the existence check while no row existed yet.
        let backend = Backend::database(config.clone());
        let mut writer = backend
            .create_file(&digest)
            .await
            .expect("asking for a writer")
            .expect("a digest nothing holds yet");
        writer.write_all(CONTENT).await.expect("writing the bytes");

        // A rival lands the row first: the window the IntegrityError branch exists for.
        let rival = FSObject {
            digest: digest.clone(),
            loid: NO_LARGE_OBJECT,
            description: Some("the winner".to_owned()),
        };
        rival
            .insert(&mut setup)
            .await
            .expect("the rival's row must land first");

        let stored = backend
            .commit(writer, &digest, "the loser")
            .await
            .expect("committing the losing writer");
        assert!(
            !stored,
            "the second writer must report that it did not store the file"
        );

        let rows: i64 =
            sqlx::query_scalar("SELECT count(*) FROM fsobjects WHERE digest = $1::varchar")
                .bind(digest.as_str())
                .fetch_one(&mut setup)
                .await
                .expect("counting the rows");
        assert_eq!(rows, 1, "one digest must name one row");

        let orphans: i64 = sqlx::query_scalar(ORPHANS_SQL)
            .bind(orphan_floor)
            .fetch_one(&mut setup)
            .await
            .expect("counting the large objects");
        assert_eq!(
            orphans, 0,
            "the losing writer's large object was left behind"
        );
    });
}
