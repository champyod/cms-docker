//! The schema this crate creates, compared with the reference's own dump.
//!
//! WHY live and WHY pg_dump: `init_db` is 300 statements of DDL, and the only
//! oracle for them is a database `cms.db.init_db` filled and `pg_dump` read back.
//! The check creates that schema in an empty database of its own and compares the
//! dump statement by statement, so a dropped `NOT NULL`, check or constraint name
//! is a failure rather than a difference nobody reads.
//!
//! Regenerate the fixture when the reference's models change: start a throwaway
//! postgres, run `from cms.db import init_db; init_db()` against it with `PYTHONPATH=src`
//! and `CMS_CONFIG` set, then `pg_dump --schema-only > dev/fixtures/cms_schema.sql`.
//!
//! RUN: CMS_DB_TEST_URL=postgres://cmsuser:***@127.0.0.1:5432/cmsdb_test \
//!        cargo test -p cms-db --test schema_live
//!
//! `pg_dump` must be on PATH: the repository's own schema test runs it the same way
//! (`src/cmstestsuite/unit_tests/schema_diff_test.py:124-133`).

use cms_db::init_db;
use sqlx::postgres::PgConnection;
use sqlx::Connection;

#[path = "support/schema_check.rs"]
mod schema_check;

use schema_check::{
    count, create_database, database_name, difference, drop_database, dump, dump_version,
    statements, with_database, CHECK_DATABASE, DOMAINS, FIXTURE, TABLES,
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

    let expected_version =
        dump_version(FIXTURE).expect("the fixture names the pg_dump that wrote it");
    assert_eq!(
        dump_version(&actual).as_deref(),
        Some(expected_version.as_str()),
        "the comparison needs the pg_dump that wrote dev/fixtures/cms_schema.sql"
    );

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
