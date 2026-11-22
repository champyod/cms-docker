//! The user-test unique constraints and composite key against a real server.
//!
//! WHY live: the rules are `UNIQUE` constraints and a composite foreign key, so
//! the server refusing the same pair is the proof that this port refuses what the
//! reference refuses. Each table is `TEMP`, so a run leaves the scratch database
//! as it found it.
//!
//! RUN: CMS_DB_TEST_URL=postgres://cmsuser:***@127.0.0.1:5432/cmsdb_test \
//!        cargo test -p cms-db --test usertest_live

// Each binary that includes this fixture uses a subset of it.
#[allow(dead_code)]
#[path = "support/usertest_db.rs"]
mod usertest_db;

use usertest_db::{
    code_of, insert_executable, insert_file, insert_manager, insert_result, open, skip, DATASET,
    OTHER_DATASET,
};

#[tokio::test]
async fn a_repeated_file_filename_is_refused_by_the_database() {
    let Some(config) = skip() else {
        return;
    };
    let mut connection = open(&config).await;
    insert_file(connection.connection(), "input.%l")
        .await
        .expect("first file");

    let refused = insert_file(connection.connection(), "input.%l").await;
    assert_eq!(code_of(&refused).as_deref(), Some("23505"));
}

#[tokio::test]
async fn a_repeated_manager_filename_is_refused_by_the_database() {
    let Some(config) = skip() else {
        return;
    };
    let mut connection = open(&config).await;
    insert_manager(connection.connection(), "grader")
        .await
        .expect("first manager");

    let refused = insert_manager(connection.connection(), "grader").await;
    assert_eq!(code_of(&refused).as_deref(), Some("23505"));
}

#[tokio::test]
async fn a_repeated_result_key_is_refused_by_the_database() {
    let Some(config) = skip() else {
        return;
    };
    let mut connection = open(&config).await;
    insert_result(connection.connection(), DATASET)
        .await
        .expect("first result");

    let refused = insert_result(connection.connection(), DATASET).await;
    assert_eq!(code_of(&refused).as_deref(), Some("23505"));
}

#[tokio::test]
async fn an_executable_without_its_result_is_refused_by_the_composite_key() {
    let Some(config) = skip() else {
        return;
    };
    let mut connection = open(&config).await;

    let refused = insert_executable(connection.connection(), OTHER_DATASET, "solution").await;
    assert_eq!(code_of(&refused).as_deref(), Some("23503"));
}

#[tokio::test]
async fn an_executable_joins_the_result_it_names() {
    let Some(config) = skip() else {
        return;
    };
    let mut connection = open(&config).await;
    insert_result(connection.connection(), DATASET)
        .await
        .expect("result row");

    insert_executable(connection.connection(), DATASET, "solution")
        .await
        .expect("matching executable");
}

#[tokio::test]
async fn a_repeated_executable_filename_is_refused_by_the_database() {
    let Some(config) = skip() else {
        return;
    };
    let mut connection = open(&config).await;
    insert_result(connection.connection(), DATASET)
        .await
        .expect("result row");
    insert_executable(connection.connection(), DATASET, "solution")
        .await
        .expect("first executable");

    let refused = insert_executable(connection.connection(), DATASET, "solution").await;
    assert_eq!(code_of(&refused).as_deref(), Some("23505"));
}
