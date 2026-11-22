//! The keys a real admin's rows resolve to, against a real database.
//!
//! WHY live: the ordering that matters — group grant, allow, wildcard expansion,
//! deny subtraction — is a fact about the rows the five tables hold, so the test
//! inserts them and reads the answer back. The tables are `TEMP`, so a run leaves
//! the scratch database as it found it.
//!
//! The suite runs when `CMS_DB_TEST_URL` names a scratch database and skips
//! otherwise, which is why the skip message is printed: a skip reported as a
//! pass proves nothing.
//!
//! RUN: CMS_DB_TEST_URL=postgres://cmsuser:***@127.0.0.1:5432/cmsdb_test \
//!        cargo test -p cms-db --test permissions

use cms_db::{effective_permissions, DedicatedConnection, SessionConfig};
use sqlx::postgres::PgConnection;

const URL_ENV: &str = "CMS_DB_TEST_URL";
const ADMIN: i32 = 10;
const GROUP: i32 = 5;

/// The tables the resolution joins, with only the columns it reads.
const SCHEMA: [&str; 5] = [
    "CREATE TEMP TABLE admins (id integer PRIMARY KEY, enabled boolean NOT NULL)",
    "CREATE TEMP TABLE permissions (id integer PRIMARY KEY, key text NOT NULL)",
    "CREATE TEMP TABLE group_permissions (group_id integer NOT NULL, permission_id integer NOT NULL)",
    "CREATE TEMP TABLE admin_groups (admin_id integer NOT NULL, group_id integer NOT NULL)",
    "CREATE TEMP TABLE admin_permission_overrides \
     (admin_id integer NOT NULL, permission_id integer NOT NULL, effect text NOT NULL)",
];

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

async fn open(config: &SessionConfig) -> DedicatedConnection {
    let mut connection = DedicatedConnection::open(config)
        .await
        .expect("opening the scratch database");
    for statement in SCHEMA {
        sqlx::query(statement)
            .execute(connection.connection())
            .await
            .expect("creating a temp table");
    }
    connection
}

async fn add_admin(connection: &mut PgConnection, id: i32, enabled: bool) {
    sqlx::query("INSERT INTO admins (id, enabled) VALUES ($1, $2)")
        .bind(id)
        .bind(enabled)
        .execute(connection)
        .await
        .expect("inserting an admin");
}

async fn add_permission(connection: &mut PgConnection, id: i32, key: &str) {
    sqlx::query("INSERT INTO permissions (id, key) VALUES ($1, $2)")
        .bind(id)
        .bind(key)
        .execute(connection)
        .await
        .expect("inserting a permission");
}

async fn grant_through_group(connection: &mut PgConnection, permissions: &[i32]) {
    sqlx::query("INSERT INTO admin_groups (admin_id, group_id) VALUES ($1, $2)")
        .bind(ADMIN)
        .bind(GROUP)
        .execute(&mut *connection)
        .await
        .expect("joining the admin to the group");
    for permission in permissions {
        sqlx::query("INSERT INTO group_permissions (group_id, permission_id) VALUES ($1, $2)")
            .bind(GROUP)
            .bind(permission)
            .execute(&mut *connection)
            .await
            .expect("granting the key to the group");
    }
}

async fn override_effect(connection: &mut PgConnection, permission: i32, effect: &str) {
    sqlx::query(
        "INSERT INTO admin_permission_overrides (admin_id, permission_id, effect) \
         VALUES ($1, $2, $3)",
    )
    .bind(ADMIN)
    .bind(permission)
    .bind(effect)
    .execute(connection)
    .await
    .expect("writing an override");
}

/// The four keys every fixture registers: the wildcard and three concrete ones.
async fn register_keys(connection: &mut PgConnection) {
    for (id, key) in [
        (1, "all:all"),
        (2, "contest:read"),
        (3, "contest:update"),
        (4, "contest:delete"),
    ] {
        add_permission(connection, id, key).await;
    }
}

#[test]
fn a_group_grant_is_held() {
    let Some(config) = skip() else { return };
    sqlx::test_block_on(async {
        let mut db = open(&config).await;
        register_keys(db.connection()).await;
        add_admin(db.connection(), ADMIN, true).await;
        grant_through_group(db.connection(), &[2]).await;

        let effective = effective_permissions(db.connection(), ADMIN)
            .await
            .expect("resolving permissions");

        assert!(effective.grants("contest:read"));
        assert!(!effective.grants("contest:update"));
    });
}

#[test]
fn an_allow_override_grants_and_a_deny_override_removes() {
    let Some(config) = skip() else { return };
    sqlx::test_block_on(async {
        let mut db = open(&config).await;
        register_keys(db.connection()).await;
        add_admin(db.connection(), ADMIN, true).await;
        grant_through_group(db.connection(), &[2]).await;
        override_effect(db.connection(), 3, "allow").await;
        override_effect(db.connection(), 2, "deny").await;

        let effective = effective_permissions(db.connection(), ADMIN)
            .await
            .expect("resolving permissions");

        assert!(
            !effective.grants("contest:read"),
            "the group grant survived"
        );
        assert!(effective.grants("contest:update"), "the allow was dropped");
    });
}

#[test]
fn a_wildcard_does_not_outrank_an_explicit_denial() {
    let Some(config) = skip() else { return };
    sqlx::test_block_on(async {
        let mut db = open(&config).await;
        register_keys(db.connection()).await;
        add_admin(db.connection(), ADMIN, true).await;
        grant_through_group(db.connection(), &[1]).await;
        override_effect(db.connection(), 2, "deny").await;

        let effective = effective_permissions(db.connection(), ADMIN)
            .await
            .expect("resolving permissions");

        assert!(!effective.grants("contest:read"), "the deny was overridden");
        assert!(
            effective.grants("contest:delete"),
            "the wildcard stopped granting"
        );
        assert!(effective.keys().contains("all:all"));
    });
}

#[test]
fn denying_the_wildcard_takes_the_whole_set_away() {
    let Some(config) = skip() else { return };
    sqlx::test_block_on(async {
        let mut db = open(&config).await;
        register_keys(db.connection()).await;
        add_admin(db.connection(), ADMIN, true).await;
        grant_through_group(db.connection(), &[1]).await;
        override_effect(db.connection(), 1, "deny").await;

        let effective = effective_permissions(db.connection(), ADMIN)
            .await
            .expect("resolving permissions");

        assert!(effective.is_empty());
        assert!(!effective.grants("contest:read"));
    });
}

#[test]
fn a_disabled_admin_holds_nothing() {
    let Some(config) = skip() else { return };
    sqlx::test_block_on(async {
        let mut db = open(&config).await;
        register_keys(db.connection()).await;
        add_admin(db.connection(), ADMIN, false).await;
        grant_through_group(db.connection(), &[1]).await;

        let effective = effective_permissions(db.connection(), ADMIN)
            .await
            .expect("resolving permissions");

        assert!(effective.is_empty());
    });
}

#[test]
fn a_missing_admin_holds_nothing() {
    let Some(config) = skip() else { return };
    sqlx::test_block_on(async {
        let mut db = open(&config).await;
        register_keys(db.connection()).await;

        let effective = effective_permissions(db.connection(), 999)
            .await
            .expect("resolving permissions");

        assert!(effective.is_empty());
    });
}
