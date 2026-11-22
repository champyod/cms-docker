//! The deployment default and its bootstrap, against a real server.
//!
//! WHY live: the states are what the catalogue holds — the table absent, present
//! and empty, present with two active rows — so the proof is a schema the server
//! created and the query answered, not a stub of the same shape.
//!
//! RUN: CMS_DB_TEST_URL=postgres://cmsuser:***@127.0.0.1:5432/cmsdb_test \
//!        cargo test -p cms-db --test contest_default_live

use cms_db::{active_contest, active_contest_id, BindingError, CONTEST_ID_ENV};

// Each binary that includes this fixture uses a subset of it.
#[allow(dead_code)]
#[path = "support/binding_db.rs"]
mod binding_db;

use binding_db::{insert_contest, open, open_bare, skip};

/// `CONTEST_ID` for as long as the guard lives, restored on the way out.
struct ContestIdVariable(Option<std::ffi::OsString>);

impl ContestIdVariable {
    fn set(value: Option<&str>) -> Self {
        let previous = std::env::var_os(CONTEST_ID_ENV);
        match value {
            Some(value) => std::env::set_var(CONTEST_ID_ENV, value),
            None => std::env::remove_var(CONTEST_ID_ENV),
        }
        Self(previous)
    }
}

impl Drop for ContestIdVariable {
    fn drop(&mut self) {
        match self.0.take() {
            Some(previous) => std::env::set_var(CONTEST_ID_ENV, previous),
            None => std::env::remove_var(CONTEST_ID_ENV),
        }
    }
}

#[tokio::test]
async fn the_lowest_active_contest_wins() {
    let Some(config) = skip() else {
        return;
    };
    let mut connection = open(&config).await;
    insert_contest(connection.connection(), 9, true).await;
    insert_contest(connection.connection(), 1, false).await;
    insert_contest(connection.connection(), 3, true).await;

    assert_eq!(
        active_contest_id(connection.connection())
            .await
            .expect("reading the deployment default"),
        Some(3)
    );
}

/// ONE test owns `CONTEST_ID`: the variable is process-wide, and a second writer
/// would race this one's states.
#[tokio::test]
async fn a_fresh_install_is_bootstrapped_only_while_the_table_is_missing() {
    let Some(config) = skip() else {
        return;
    };
    let mut bare = open_bare(&config).await;
    let mut empty = open(&config).await;
    insert_contest(empty.connection(), 1, false).await;

    let bootstrap = ContestIdVariable::set(Some("42"));
    assert_eq!(
        active_contest(bare.connection())
            .await
            .expect("the environment names the contest"),
        42,
        "before the table exists the environment is the only source"
    );
    assert!(
        matches!(
            active_contest(empty.connection()).await,
            Err(BindingError::NoActiveContest)
        ),
        "an existing table with no active row must not bootstrap"
    );
    assert!(
        matches!(
            active_contest_id(bare.connection()).await,
            Err(BindingError::MissingContests)
        ),
        "the default must not be read from the environment"
    );
    drop(bootstrap);

    let absent = ContestIdVariable::set(None);
    assert!(
        matches!(
            active_contest(bare.connection()).await,
            Err(BindingError::BootstrapUnset)
        ),
        "a fresh install with no CONTEST_ID has nothing to serve"
    );
    drop(absent);
}
