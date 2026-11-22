//! The `contests` and `services` columns the binding rules read.
//!
//! Both tables are `TEMP`, so every connection gets its own copy and a run leaves
//! the scratch database as it found it. A test that needs the tables absent opens
//! a connection through [`open_bare`] and never creates them.

use cms_db::{DedicatedConnection, SessionConfig};
use sqlx::postgres::PgConnection;

/// The environment variable naming the scratch database.
pub const URL_ENV: &str = "CMS_DB_TEST_URL";

const CREATE_CONTESTS: &str = "\
    CREATE TEMP TABLE contests (\
        id integer PRIMARY KEY, \
        name text NOT NULL, \
        is_active boolean NOT NULL DEFAULT false)";

const CREATE_SERVICES: &str = "\
    CREATE TEMP TABLE services (\
        id serial PRIMARY KEY, \
        name varchar NOT NULL, \
        role varchar NOT NULL, \
        shard integer NOT NULL DEFAULT 0, \
        host varchar NOT NULL DEFAULT '127.0.0.1', \
        contest_id integer, \
        enabled boolean NOT NULL DEFAULT true)";

/// The scratch database, or a printed skip when none is configured.
pub fn skip() -> Option<SessionConfig> {
    let config = std::env::var(URL_ENV)
        .ok()
        .filter(|url| !url.trim().is_empty())
        .map(SessionConfig::new);
    if config.is_none() {
        eprintln!("SKIP: set {URL_ENV} to a scratch database to run the live half");
    }
    config
}

/// A connection with neither table, for the states a fresh install is in.
pub async fn open_bare(config: &SessionConfig) -> DedicatedConnection {
    DedicatedConnection::open(config)
        .await
        .expect("opening the scratch database")
}

/// A connection carrying both tables.
pub async fn open(config: &SessionConfig) -> DedicatedConnection {
    let mut connection = open_bare(config).await;
    for statement in [CREATE_CONTESTS, CREATE_SERVICES] {
        sqlx::query(statement)
            .execute(connection.connection())
            .await
            .expect("creating the binding schema");
    }
    connection
}

/// One contest row, with its flag set as given.
pub async fn insert_contest(connection: &mut PgConnection, id: i32, is_active: bool) {
    sqlx::query("INSERT INTO contests (id, name, is_active) VALUES ($1, $2, $3)")
        .bind(id)
        .bind(format!("contest-{id}"))
        .bind(is_active)
        .execute(connection)
        .await
        .expect("inserting a contest");
}

/// One registry row for `role` shard `shard`, naming `contest_id` or every contest.
pub async fn insert_service(
    connection: &mut PgConnection,
    role: &str,
    shard: i32,
    contest_id: Option<i32>,
    enabled: bool,
) {
    sqlx::query(
        "INSERT INTO services (name, role, shard, contest_id, enabled) \
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(format!("{role}-{shard}"))
    .bind(role)
    .bind(shard)
    .bind(contest_id)
    .bind(enabled)
    .execute(connection)
    .await
    .expect("inserting a registry row");
}
