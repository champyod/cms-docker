//! The scoring write boundary against a real server.
//!
//! RUN: CMS_DB_TEST_URL=postgres://cmsuser:***@127.0.0.1:5432/cmsdb_test \
//!        cargo test -p cms-db --test scoring_write_live

use chrono::NaiveDateTime;
use cms_db::{write_score, DatasetId, ScoreRow, SubmissionId};
use sqlx::postgres::PgConnection;
use sqlx::AssertSqlSafe;

// This binary owns the scratch schema for every case it runs.
#[allow(dead_code)]
#[path = "support/util_db.rs"]
mod util_db;

use util_db::{open, seed_datasets, skip};

const SUBMISSION: i32 = 320;
const DATASET: i32 = 20;

/// The non-key columns read back after a score write.
#[derive(Debug, PartialEq, sqlx::FromRow)]
struct StoredScore {
    score: Option<f64>,
    score_details: Option<String>,
    scored_at: Option<NaiveDateTime>,
    public_score: Option<f64>,
    public_score_details: Option<String>,
    ranking_score_details: Option<Vec<String>>,
}

/// A deterministic instant for the score stamp.
fn at(second: u32) -> NaiveDateTime {
    NaiveDateTime::parse_from_str(
        &format!("2026-01-01 00:00:{second:02}"),
        "%Y-%m-%d %H:%M:%S",
    )
    .expect("a valid fixture timestamp")
}

/// The first score, with every stored column set.
fn first_score() -> ScoreRow {
    ScoreRow {
        submission_id: SubmissionId(SUBMISSION),
        dataset_id: DatasetId(DATASET),
        score: Some(12.5),
        score_details: Some("{\"score\": 12.5}".to_string()),
        scored_at: Some(at(1)),
        public_score: Some(7.25),
        public_score_details: Some("{\"public\": 7.25}".to_string()),
        ranking_score_details: Some(vec!["12.5".to_string()]),
    }
}

/// The replacement score, distinct in every stored column.
fn replacement_score() -> ScoreRow {
    ScoreRow {
        submission_id: SubmissionId(SUBMISSION),
        dataset_id: DatasetId(DATASET),
        score: Some(80.0),
        score_details: Some("{\"score\": 80}".to_string()),
        scored_at: Some(at(2)),
        public_score: Some(60.0),
        public_score_details: Some("{\"public\": 60}".to_string()),
        ranking_score_details: Some(vec!["80".to_string(), "first".to_string()]),
    }
}

/// The submission and dataset the score row names.
async fn seed_score_target(connection: &mut PgConnection) {
    seed_datasets(connection).await;
    sqlx::raw_sql(AssertSqlSafe(
        "INSERT INTO submissions (id, task_id, participation_id, timestamp)
         VALUES (320, 10, 100, '2026-01-01 00:00:00')",
    ))
    .execute(connection)
    .await
    .expect("seeding the score target");
}

/// Read the row through PostgreSQL's own jsonb and array decoders.
async fn read_score(connection: &mut PgConnection) -> StoredScore {
    sqlx::query_as::<_, StoredScore>(
        "SELECT score, score_details::text AS score_details, scored_at,
                public_score, public_score_details::text AS public_score_details,
                ranking_score_details
         FROM submission_results
         WHERE submission_id = $1 AND dataset_id = $2",
    )
    .bind(SUBMISSION)
    .bind(DATASET)
    .fetch_one(connection)
    .await
    .expect("reading the stored score")
}

/// Every value of `expected` is what the database returned.
fn assert_stored_score(actual: &StoredScore, expected: &ScoreRow) {
    assert_eq!(actual.score, expected.score);
    assert_eq!(actual.score_details, expected.score_details);
    assert_eq!(actual.scored_at, expected.scored_at);
    assert_eq!(actual.public_score, expected.public_score);
    assert_eq!(actual.public_score_details, expected.public_score_details);
    assert_eq!(actual.ranking_score_details, expected.ranking_score_details);
}

#[tokio::test]
async fn write_score_round_trips_every_column_and_replaces_an_existing_score() {
    let Some(url) = skip() else {
        return;
    };
    let mut connection = open(&url).await;
    seed_score_target(&mut connection).await;
    let first = first_score();

    write_score(&mut connection, &first)
        .await
        .expect("inserting the score");
    assert_stored_score(&read_score(&mut connection).await, &first);

    let replacement = replacement_score();
    write_score(&mut connection, &replacement)
        .await
        .expect("replacing the score");
    assert_stored_score(&read_score(&mut connection).await, &replacement);
    let rows: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM submission_results WHERE submission_id = $1 AND dataset_id = $2",
    )
    .bind(SUBMISSION)
    .bind(DATASET)
    .fetch_one(&mut connection)
    .await
    .expect("counting the score row");
    assert_eq!(rows, 1);
}
