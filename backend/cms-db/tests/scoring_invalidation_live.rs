//! Score invalidation against a real server.
//!
//! RUN: CMS_DB_TEST_URL=postgres://cmsuser:***@127.0.0.1:5432/cmsdb_test \
//!        cargo test -p cms-db --test scoring_invalidation_live

use chrono::NaiveDateTime;
use cms_db::{invalidate_score, result_by_id, DatasetId, SubmissionId, SubmissionResult};
use sqlx::postgres::PgConnection;
use sqlx::AssertSqlSafe;

#[allow(dead_code)]
#[path = "support/util_db.rs"]
mod util_db;

use util_db::{open, seed_datasets, skip};

const SCORED: i32 = 310;
const UNSCORED: i32 = 311;
const PARTIAL: i32 = 312;
const DATASET: i32 = 20;

/// The instant a fixture row carries.
fn at(second: u32) -> NaiveDateTime {
    NaiveDateTime::parse_from_str(
        &format!("2026-01-01 00:00:{second:02}"),
        "%Y-%m-%d %H:%M:%S",
    )
    .expect("a valid fixture timestamp")
}

/// Fully scored, unscored and partially scored results under one dataset.
async fn seed_results(connection: &mut PgConnection) {
    seed_datasets(connection).await;
    sqlx::raw_sql(AssertSqlSafe(
        "INSERT INTO submissions (id, task_id, participation_id, timestamp) VALUES
            (310, 10, 100, '2026-01-01 00:00:01'),
            (311, 10, 100, '2026-01-01 00:00:02'),
            (312, 10, 100, '2026-01-01 00:00:03')",
    ))
    .execute(&mut *connection)
    .await
    .expect("seeding the submissions");
    sqlx::raw_sql(AssertSqlSafe(
        "INSERT INTO submission_results
            (submission_id, dataset_id, score, score_details, scored_at,
             public_score, public_score_details, ranking_score_details)
         VALUES
            (310, 20, 12.5, '{\"score\": 12.5}', '2026-01-01 00:00:09',
             7.25, '{\"public\": 7.25}', ARRAY['12.5']),
            (311, 20, NULL, NULL, '2026-01-01 00:00:08',
             NULL, NULL, NULL),
            (312, 20, 99, '{}', '2026-01-01 00:00:07',
             NULL, NULL, NULL)",
    ))
    .execute(&mut *connection)
    .await
    .expect("seeding the results");
}

/// The score stamp is historical metadata, not one of the five invalidated fields.
async fn scored_at(
    connection: &mut PgConnection,
    submission: SubmissionId,
) -> Option<NaiveDateTime> {
    sqlx::query_scalar(
        "SELECT scored_at FROM submission_results
         WHERE submission_id = $1 AND dataset_id = $2",
    )
    .bind(submission.0)
    .bind(DATASET)
    .fetch_one(connection)
    .await
    .expect("reading the score stamp")
}

#[tokio::test]
async fn invalidation_blanks_only_a_fully_scored_result() {
    let Some(url) = skip() else {
        return;
    };
    let mut connection = open(&url).await;
    seed_results(&mut connection).await;

    assert_invalidated(&mut connection, SCORED, at(1), at(9)).await;
    let unscored = assert_untouched(&mut connection, UNSCORED).await;
    assert_blank_scores(&unscored);
    assert_eq!(
        scored_at(&mut connection, SubmissionId(UNSCORED)).await,
        Some(at(8))
    );

    let partial = assert_untouched(&mut connection, PARTIAL).await;
    assert_eq!(partial.score, Some(99.0));
    assert_eq!(partial.score_details.as_deref(), Some("{}"));
    assert_eq!(partial.public_score, None);
    assert_eq!(partial.public_score_details, None);
    assert_eq!(partial.ranking_score_details, None);
    assert_eq!(
        scored_at(&mut connection, SubmissionId(PARTIAL)).await,
        Some(at(7))
    );
}

async fn assert_invalidated(
    connection: &mut PgConnection,
    submission: i32,
    timestamp: NaiveDateTime,
    stamp: NaiveDateTime,
) {
    assert_eq!(
        invalidate_score(connection, SubmissionId(submission), DatasetId(DATASET))
            .await
            .expect("invalidating the scored result"),
        Some(timestamp)
    );
    let result = result_by_id(connection, SubmissionId(submission), DatasetId(DATASET))
        .await
        .expect("reading the invalidated result")
        .expect("the scored result still exists");
    assert_blank_scores(&result);
    assert_eq!(
        scored_at(connection, SubmissionId(submission)).await,
        Some(stamp)
    );
}

async fn assert_untouched(connection: &mut PgConnection, submission: i32) -> SubmissionResult {
    assert_eq!(
        invalidate_score(connection, SubmissionId(submission), DatasetId(DATASET))
            .await
            .expect("invalidating the unscored result"),
        None
    );
    result_by_id(connection, SubmissionId(submission), DatasetId(DATASET))
        .await
        .expect("reading the untouched result")
        .expect("the untouched result still exists")
}

fn assert_blank_scores(result: &SubmissionResult) {
    assert_eq!(result.score, None);
    assert_eq!(result.score_details, None);
    assert_eq!(result.public_score, None);
    assert_eq!(result.public_score_details, None);
    assert_eq!(result.ranking_score_details, None);
}
