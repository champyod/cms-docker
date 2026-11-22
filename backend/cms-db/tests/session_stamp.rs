//! The actor stamp, against a real transaction.
//!
//! WHY live: the property is that COMMIT ends the transaction and resets the
//! transaction-local GUC, and no in-memory stand-in reproduces that. The suite
//! runs when `CMS_DB_TEST_URL` names a scratch database and skips otherwise, which
//! is what lets the rest of the crate's tests run on a machine without a server.
//!
//! RUN: CMS_DB_TEST_URL=postgres://cmsuser:***@127.0.0.1:5432/cmsdb_test \
//!        cargo test -p cms-db --test session_stamp

use std::ffi::OsString;
use std::sync::{Mutex, MutexGuard};

use cms_db::{DedicatedConnection, Session, SessionConfig, ACTOR_ENV};
use sqlx::postgres::PgConnection;
use sqlx::Row;

const URL_ENV: &str = "CMS_DB_TEST_URL";
const TEST_ACTOR: &str = "admin:12";

/// The tests here write one process-wide variable, so they take turns.
static ENVIRONMENT: Mutex<()> = Mutex::new(());

/// Holds the environment at one actor and restores it on drop.
struct ActorEnvironment {
    _lock: MutexGuard<'static, ()>,
    previous: Option<OsString>,
}

impl ActorEnvironment {
    fn at(actor: &str) -> Self {
        let lock = ENVIRONMENT
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let previous = std::env::var_os(ACTOR_ENV);
        std::env::set_var(ACTOR_ENV, actor);
        Self {
            _lock: lock,
            previous,
        }
    }
}

impl Drop for ActorEnvironment {
    fn drop(&mut self) {
        match self.previous.take() {
            Some(previous) => std::env::set_var(ACTOR_ENV, previous),
            None => std::env::remove_var(ACTOR_ENV),
        }
    }
}

fn config() -> Option<SessionConfig> {
    std::env::var(URL_ENV)
        .ok()
        .filter(|url| !url.trim().is_empty())
        .map(SessionConfig::new)
}

fn skip() -> Option<SessionConfig> {
    let config = config();
    if config.is_none() {
        eprintln!("SKIP: set {URL_ENV} to a scratch database to run the live half");
    }
    config
}

async fn current_actor(connection: &mut PgConnection) -> Option<String> {
    sqlx::query("SELECT current_setting('cms.actor', true) AS actor")
        .fetch_one(connection)
        .await
        .expect("reading cms.actor")
        .get("actor")
}

#[test]
fn the_configured_actor_stamps_the_transaction_a_session_begins() {
    let Some(config) = skip() else { return };
    sqlx::test_block_on(async {
        let _environment = ActorEnvironment::at(TEST_ACTOR);
        let session = Session::open(&config).await.expect("opening the session");
        assert_eq!(session.actor(), TEST_ACTOR);

        let mut transaction = session.begin().await.expect("beginning a transaction");
        assert_eq!(
            current_actor(transaction.connection()).await.as_deref(),
            Some(TEST_ACTOR)
        );
        transaction.rollback().await.expect("rollback");
    });
}

#[test]
fn a_commit_and_a_second_begin_stamps_again() {
    let Some(config) = skip() else { return };
    sqlx::test_block_on(async {
        let _environment = ActorEnvironment::at(TEST_ACTOR);
        let session = Session::open(&config).await.expect("opening the session");

        let mut first = session
            .begin()
            .await
            .expect("beginning the first transaction");
        assert_eq!(
            current_actor(first.connection()).await.as_deref(),
            Some(TEST_ACTOR),
            "the first transaction was not stamped"
        );
        sqlx::query("SELECT set_config('cms.actor', 'admin:99', true)")
            .execute(first.connection())
            .await
            .expect("widening the identity inside the transaction");
        assert_eq!(
            current_actor(first.connection()).await.as_deref(),
            Some("admin:99")
        );
        first
            .commit()
            .await
            .expect("committing the first transaction");

        // The commit ended that transaction, so continuing is a new begin. A stamp
        // applied once per session or connection reads back either the value the
        // caller planted or nothing at all here, which is exactly the mid-way
        // commit paths the reference's comment warns about.
        let mut second = session
            .begin()
            .await
            .expect("beginning the second transaction");
        assert_eq!(
            current_actor(second.connection()).await.as_deref(),
            Some(TEST_ACTOR),
            "the second transaction was not stamped"
        );
        second.rollback().await.expect("rollback");
    });
}

#[test]
fn the_dedicated_connection_keeps_its_identity_across_a_commit() {
    let Some(config) = skip() else { return };
    sqlx::test_block_on(async {
        let _environment = ActorEnvironment::at(TEST_ACTOR);
        let mut connection = DedicatedConnection::open(&config)
            .await
            .expect("opening the dedicated connection");
        assert!(!connection.username().is_empty());

        assert_eq!(
            current_actor(connection.connection()).await.as_deref(),
            Some(TEST_ACTOR)
        );
        for statement in ["BEGIN", "COMMIT"] {
            sqlx::query(statement)
                .execute(connection.connection())
                .await
                .expect("running a transaction");
        }
        assert_eq!(
            current_actor(connection.connection()).await.as_deref(),
            Some(TEST_ACTOR),
            "a commit cleared the session-scope stamp of a never-pooled connection"
        );
    });
}
