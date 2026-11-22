//! The contest list and the judgeable datasets against a real server.
//!
//! RUN: CMS_DB_TEST_URL=postgres://cmsuser:***@127.0.0.1:5432/cmsdb_test \
//!        cargo test -p cms-db --test reads_util_live

use cms_db::{get_contest_list, get_datasets_to_judge, is_contest_id, Task, TokenMode};
use sqlx::postgres::PgConnection;
use sqlx::AssertSqlSafe;

// Each binary that includes this fixture uses a subset of it.
#[allow(dead_code)]
#[path = "support/util_db.rs"]
mod util_db;

use util_db::{open, seed_datasets, skip, CONTEST, TASK};

/// The two datasets a submission is judged on.
const ACTIVE_DATASET: i32 = 20;
const AUTOJUDGE_DATASET: i32 = 21;

/// Run one statement the fixture wrote, binding nothing.
async fn execute(connection: &mut PgConnection, statement: &'static str) {
    sqlx::raw_sql(AssertSqlSafe(statement))
        .execute(&mut *connection)
        .await
        .expect("seeding the fixture");
}

#[tokio::test]
async fn every_contest_reads_back_with_the_modes_and_defaults_it_was_stored_with() {
    let Some(url) = skip() else {
        return;
    };
    let mut connection = open(&url).await;
    execute(
        &mut connection,
        "UPDATE contests SET token_mode = 'finite' WHERE id = 1",
    )
    .await;

    let contests = get_contest_list(&mut connection)
        .await
        .expect("reading the contests");

    assert_eq!(contests.len(), 2);
    let alpha = contests
        .iter()
        .find(|contest| contest.id == CONTEST)
        .expect("the first fixture contest");
    assert_eq!(alpha.name.as_str(), "alpha");
    assert_eq!(alpha.token_mode, TokenMode::Finite);
    assert!(alpha.submissions_download_allowed);
    assert!(alpha.allowed_localizations.is_empty() && alpha.languages.is_empty());
    assert!(!alpha.is_active);

    assert!(is_contest_id(&mut connection, CONTEST).await.unwrap());
    assert!(!is_contest_id(&mut connection, 9_999).await.unwrap());
}

#[tokio::test]
async fn only_the_active_dataset_and_the_autojudge_ones_are_judged() {
    let Some(url) = skip() else {
        return;
    };
    let mut connection = open(&url).await;
    seed_datasets(&mut connection).await;
    let task = Task::get(&mut connection, TASK)
        .await
        .expect("reading the task")
        .expect("the task the fixture seeded");

    let judge = get_datasets_to_judge(&mut connection, &task)
        .await
        .expect("reading the judgeable datasets");

    let mut ids: Vec<i32> = judge.iter().map(|dataset| dataset.id.0).collect();
    ids.sort_unstable();
    assert_eq!(ids, vec![ACTIVE_DATASET, AUTOJUDGE_DATASET]);
    assert!(judge
        .iter()
        .any(|dataset| dataset.id.0 == ACTIVE_DATASET && dataset.is_active));
    assert!(judge
        .iter()
        .any(|dataset| dataset.id.0 == AUTOJUDGE_DATASET && !dataset.is_active));
}
