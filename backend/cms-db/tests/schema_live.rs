//! The schema this crate creates, compared with the reference's own dump.
//!
//! WHY live and WHY a dump: `init_db`'s only oracle is a database it filled, read back by pg_dump.
//! The check builds that schema in an empty database and compares the dumps statement by statement.
//! A dropped `NOT NULL`, check or constraint name is then a failure, not a line nobody reads.
//! A fixture from another pg_dump fails by naming both versions, not as 224 schema differences.
//! The dumper is the postgres image docker-compose.yml pins, because production runs that image.
//! Regenerate the fixture from a throwaway database of that image, after `init_db()` filled it.
//! RUN: CMS_DB_TEST_URL=postgres://cmsuser:testpass@127.0.0.1:5432/cmsdb_test cargo test

use cms_db::init_db;
use sqlx::postgres::PgConnection;
use sqlx::Connection;

#[path = "support/pg_dump.rs"]
mod pg_dump;
#[path = "support/schema_check.rs"]
mod schema_check;

use pg_dump::{dump, dump_version, version};
use schema_check::{
    count, create_database, database_name, difference, drop_database, statements, with_database,
    CHECK_DATABASE, DOMAINS, FIXTURE, TABLES,
};

/// What the base database's name must carry, so a real one is never the target.
const REQUIRED_NAME_FRAGMENT: &str = "test";

#[tokio::test]
async fn the_created_schema_matches_the_frozen_dump() {
    let Some(url) = schema_check::skip() else {
        return;
    };
    assert!(
        database_name(&url).contains(REQUIRED_NAME_FRAGMENT),
        "{url} does not name a scratch database, so this check will not create one beside it"
    );
    let check_url = with_database(&url, CHECK_DATABASE);

    // WHY before creating the database: a dumper mismatch makes every statement a difference.
    let written_by =
        dump_version(FIXTURE).expect("dev/fixtures/cms_schema.sql names the pg_dump that wrote it");
    let pinned = version();
    assert_eq!(
        written_by, pinned,
        "fixture is pg_dump {written_by}, pinned image is pg_dump {pinned}: regenerate the fixture"
    );

    let mut base = PgConnection::connect(&url)
        .await
        .expect("connecting to the scratch database");
    create_database(&mut base, CHECK_DATABASE).await;

    let mut connection = PgConnection::connect(&check_url)
        .await
        .expect("connecting to the check database");
    init_db(&mut connection)
        .await
        .expect("the frozen schema creates on an empty database");

    let tables = count(
        &mut connection,
        "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'",
    )
    .await;
    let domains = count(
        &mut connection,
        "SELECT count(*) FROM pg_type WHERE typtype = 'd' \
         AND typnamespace = 'public'::regnamespace",
    )
    .await;
    drop(connection);

    let actual = dump(&check_url);
    drop_database(&mut base, CHECK_DATABASE).await;

    assert_eq!(tables, TABLES, "the reference creates {TABLES} tables");
    assert_eq!(domains, DOMAINS, "the reference creates {DOMAINS} domains");

    let expected = statements(FIXTURE);
    let created = statements(&actual);
    assert_eq!(
        difference(&expected, &created),
        "",
        "the created schema differs from dev/fixtures/cms_schema.sql"
    );
}
