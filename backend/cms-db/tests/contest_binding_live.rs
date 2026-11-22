//! The registry row an instance's contest is read from, against a real server.
//!
//! WHY live: the answers differ only in what a row holds — NULL, disabled, a
//! repeated `(role, shard)` — so the proof is a row the server stores and the
//! query reading it back, not a mock of the same shape.
//!
//! RUN: CMS_DB_TEST_URL=postgres://cmsuser:***@127.0.0.1:5432/cmsdb_test \
//!        cargo test -p cms-db --test contest_binding_live

use cms_db::service_binding;

// Each binary that includes this fixture uses a subset of it.
#[allow(dead_code)]
#[path = "support/binding_db.rs"]
mod binding_db;

use binding_db::{insert_service, open, open_bare, skip};

#[tokio::test]
async fn the_row_for_this_instance_answers() {
    let Some(config) = skip() else {
        return;
    };
    let mut connection = open(&config).await;
    insert_service(
        connection.connection(),
        "ContestWebServer",
        0,
        Some(8),
        true,
    )
    .await;
    insert_service(
        connection.connection(),
        "ContestWebServer",
        1,
        Some(3),
        true,
    )
    .await;

    let first = service_binding(connection.connection(), "ContestWebServer", 0)
        .await
        .expect("reading the registry");
    let second = service_binding(connection.connection(), "ContestWebServer", 1)
        .await
        .expect("reading the registry");

    assert!(first.named);
    assert_eq!(first.contest_id, Some(8));
    assert_eq!(second.contest_id, Some(3));
}

#[tokio::test]
async fn a_row_that_names_no_contest_is_named_and_means_every_contest() {
    let Some(config) = skip() else {
        return;
    };
    let mut connection = open(&config).await;
    insert_service(connection.connection(), "EvaluationService", 0, None, true).await;

    let binding = service_binding(connection.connection(), "EvaluationService", 0)
        .await
        .expect("reading the registry");

    assert!(binding.named, "a null row still names the instance");
    assert_eq!(binding.contest_id, None);
}

#[tokio::test]
async fn a_role_and_shard_no_row_names_is_unnamed() {
    let Some(config) = skip() else {
        return;
    };
    let mut connection = open(&config).await;
    insert_service(
        connection.connection(),
        "ContestWebServer",
        0,
        Some(8),
        true,
    )
    .await;

    let binding = service_binding(connection.connection(), "ContestWebServer", 3)
        .await
        .expect("reading the registry");

    assert!(!binding.named);
    assert_eq!(binding.contest_id, None);
}

#[tokio::test]
async fn a_disabled_row_names_nothing() {
    let Some(config) = skip() else {
        return;
    };
    let mut connection = open(&config).await;
    insert_service(connection.connection(), "ProxyService", 0, Some(8), false).await;

    let disabled = service_binding(connection.connection(), "ProxyService", 0)
        .await
        .expect("reading the registry");

    assert!(!disabled.named, "a disabled row must not bind the instance");

    insert_service(connection.connection(), "ProxyService", 0, Some(3), true).await;
    let enabled = service_binding(connection.connection(), "ProxyService", 0)
        .await
        .expect("reading the registry");

    assert_eq!(enabled.contest_id, Some(3), "the enabled row is the answer");
}

#[tokio::test]
async fn the_lowest_id_wins_when_a_role_and_shard_repeat() {
    let Some(config) = skip() else {
        return;
    };
    let mut connection = open(&config).await;
    insert_service(
        connection.connection(),
        "ContestWebServer",
        0,
        Some(8),
        true,
    )
    .await;
    insert_service(
        connection.connection(),
        "ContestWebServer",
        0,
        Some(3),
        true,
    )
    .await;

    let binding = service_binding(connection.connection(), "ContestWebServer", 0)
        .await
        .expect("reading the registry");

    assert_eq!(
        binding.contest_id,
        Some(8),
        "the reference ordered by id and took the first"
    );
}

#[tokio::test]
async fn no_registry_table_is_not_a_named_instance() {
    let Some(config) = skip() else {
        return;
    };
    let mut connection = open_bare(&config).await;

    let binding = service_binding(connection.connection(), "ContestWebServer", 0)
        .await
        .expect("a missing table is an answer, not a failure");

    assert!(!binding.named);
    assert_eq!(binding.contest_id, None);
}
