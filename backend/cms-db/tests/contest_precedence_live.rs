//! The precedence an instance's contest is settled by, against a real server.
//!
//! WHY live: the three layers are told apart only by what the tables hold — a row
//! naming a contest, a row naming every contest, no row at all — so the proof is
//! those rows and the flag, not a stub that answers the same shape.
//!
//! RUN: CMS_DB_TEST_URL=postgres://cmsuser:***@127.0.0.1:5432/cmsdb_test \
//!        cargo test -p cms-db --test contest_precedence_live

use cms_db::{contest_binding, BindingError, ContestOverride, NO_OVERRIDE};

// Each binary that includes this fixture uses a subset of it.
#[allow(dead_code)]
#[path = "support/binding_db.rs"]
mod binding_db;

use binding_db::{insert_contest, insert_service, open, open_bare, skip};

#[tokio::test]
async fn the_registry_row_beats_the_active_flag() {
    let Some(config) = skip() else {
        return;
    };
    let mut connection = open(&config).await;
    insert_contest(connection.connection(), 7, true).await;
    insert_service(
        connection.connection(),
        "ContestWebServer",
        0,
        Some(8),
        true,
    )
    .await;

    assert_eq!(
        contest_binding(
            connection.connection(),
            "ContestWebServer",
            0,
            NO_OVERRIDE,
            false
        )
        .await
        .expect("resolving the binding"),
        Some(8)
    );
}

#[tokio::test]
async fn a_row_that_names_every_contest_is_not_resolved_again() {
    let Some(config) = skip() else {
        return;
    };
    let mut connection = open(&config).await;
    insert_contest(connection.connection(), 7, true).await;
    insert_service(connection.connection(), "EvaluationService", 0, None, true).await;

    assert_eq!(
        contest_binding(
            connection.connection(),
            "EvaluationService",
            0,
            NO_OVERRIDE,
            false
        )
        .await
        .expect("resolving the binding"),
        None,
        "a named row answers, and its answer is every contest"
    );
}

#[tokio::test]
async fn an_instance_no_row_names_serves_the_deployment_default() {
    let Some(config) = skip() else {
        return;
    };
    let mut connection = open(&config).await;
    insert_contest(connection.connection(), 7, true).await;

    assert_eq!(
        contest_binding(
            connection.connection(),
            "ContestWebServer",
            3,
            NO_OVERRIDE,
            false
        )
        .await
        .expect("resolving the binding"),
        Some(7)
    );
}

#[tokio::test]
async fn an_override_wins_and_reads_no_table() {
    let Some(config) = skip() else {
        return;
    };
    let mut connection = open_bare(&config).await;

    assert_eq!(
        contest_binding(
            connection.connection(),
            "ContestWebServer",
            0,
            ContestOverride::Contest(3),
            false
        )
        .await
        .expect("an override needs no table"),
        Some(3)
    );
}

#[tokio::test]
async fn an_override_of_every_contest_is_not_a_lookup() {
    let Some(config) = skip() else {
        return;
    };
    let mut connection = open_bare(&config).await;

    assert_eq!(
        contest_binding(
            connection.connection(),
            "ContestWebServer",
            0,
            ContestOverride::EveryContest,
            false
        )
        .await
        .expect("the override answers without a table"),
        None
    );
}

#[tokio::test]
async fn an_override_of_every_contest_beats_the_registry_and_the_flag() {
    let Some(config) = skip() else {
        return;
    };
    let mut connection = open(&config).await;
    insert_contest(connection.connection(), 7, true).await;
    insert_service(
        connection.connection(),
        "ContestWebServer",
        0,
        Some(8),
        true,
    )
    .await;

    assert_eq!(
        contest_binding(
            connection.connection(),
            "ContestWebServer",
            0,
            ContestOverride::EveryContest,
            false
        )
        .await
        .expect("resolving the binding"),
        None,
        "the override is the answer, not a hint to keep looking"
    );
}

#[tokio::test]
async fn a_single_contest_service_that_cannot_be_bound_is_refused() {
    let Some(config) = skip() else {
        return;
    };
    let mut connection = open(&config).await;
    insert_contest(connection.connection(), 7, true).await;
    insert_service(connection.connection(), "ProxyService", 0, None, true).await;

    match contest_binding(
        connection.connection(),
        "ProxyService",
        0,
        NO_OVERRIDE,
        true,
    )
    .await
    {
        Err(BindingError::EveryContestOnSingleContestService { role, shard }) => {
            assert_eq!(role, "ProxyService");
            assert_eq!(shard, 0);
        }
        other => panic!("a single-contest service must be refused, got {other:?}"),
    }
}

#[tokio::test]
async fn a_single_contest_service_serves_the_row_that_names_it() {
    let Some(config) = skip() else {
        return;
    };
    let mut connection = open(&config).await;
    insert_service(connection.connection(), "ProxyService", 0, Some(8), true).await;

    assert_eq!(
        contest_binding(
            connection.connection(),
            "ProxyService",
            0,
            NO_OVERRIDE,
            true
        )
        .await
        .expect("a named row is a contest to serve"),
        Some(8)
    );
}
