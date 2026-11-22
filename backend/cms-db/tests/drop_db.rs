//! The teardown, against a real database.
//!
//! WHY live: dropping schema `public` and unlinking large objects are statements
//! only a server can accept. The suite is destructive, so it refuses to run against
//! a database whose name does not carry `test`, which is what keeps a mistyped
//! `CMS_DB_TEST_URL` from emptying the wrong database.
//!
//! RUN: CMS_DB_TEST_URL=postgres://cmsuser:***@127.0.0.1:5432/cmsdb_test \
//!        cargo test -p cms-db --test drop_db

use cms_db::{drop_db, DedicatedConnection, SessionConfig};
use sqlx::postgres::PgConnection;
use sqlx::Row;

const URL_ENV: &str = "CMS_DB_TEST_URL";

/// What the database must be named, so a real one is never the target.
const REQUIRED_NAME_FRAGMENT: &str = "test";

async fn scalar(connection: &mut PgConnection, sql: &'static str) -> i64 {
    sqlx::query(sql)
        .fetch_one(connection)
        .await
        .expect("running a probe")
        .get(0)
}

async fn database_name(connection: &mut PgConnection) -> String {
    sqlx::query("SELECT current_database() AS name")
        .fetch_one(connection)
        .await
        .expect("reading the database name")
        .get("name")
}

#[test]
fn the_teardown_empties_the_schema_and_unlinks_large_objects() {
    let Some(config) = std::env::var(URL_ENV)
        .ok()
        .filter(|url| !url.trim().is_empty())
        .map(SessionConfig::new)
    else {
        eprintln!("SKIP: set {URL_ENV} to a scratch database to run the live half");
        return;
    };

    sqlx::test_block_on(async {
        let mut connection = DedicatedConnection::open(&config)
            .await
            .expect("opening the dedicated connection");

        let database = database_name(connection.connection()).await;
        assert!(
            database.contains(REQUIRED_NAME_FRAGMENT),
            "refusing to empty {database:?}: the name must carry {REQUIRED_NAME_FRAGMENT:?}"
        );

        sqlx::query("CREATE TABLE IF NOT EXISTS drop_probe (id integer)")
            .execute(connection.connection())
            .await
            .expect("creating a probe table");
        let object: i64 = sqlx::query("SELECT lo_create(0)::bigint AS oid")
            .fetch_one(connection.connection())
            .await
            .expect("creating a large object")
            .get("oid");

        let tables = scalar(
            connection.connection(),
            "SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename = 'drop_probe'",
        )
        .await;
        assert_eq!(tables, 1, "the probe table was not created");

        drop_db(&mut connection)
            .await
            .expect("emptying the database");

        let tables = scalar(
            connection.connection(),
            "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'",
        )
        .await;
        assert_eq!(tables, 0, "the schema still holds tables");

        let object_still_there: i64 = sqlx::query(
            "SELECT count(*) AS count FROM pg_largeobject_metadata WHERE oid = $1::oid",
        )
        .bind(object)
        .fetch_one(connection.connection())
        .await
        .expect("counting the large object")
        .get("count");
        assert_eq!(
            object_still_there, 0,
            "the large object {object} still exists"
        );
    });
}
