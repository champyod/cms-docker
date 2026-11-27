//! Compilation invalidation against the frozen schema and a real server.
//!
//! RUN: CMS_DB_TEST_URL=postgres://postgres:***@127.0.0.1:15433/cmsdb_test \
//!        cargo test -p cms-db --test commit_invalidation_live

use cms_db::{commit, CompilationOutcome, ResultRow};
use sqlx::postgres::PgConnection;
use sqlx::{AssertSqlSafe, FromRow};

#[path = "../support/commit.rs"]
mod commit_support;

use commit_support::{
    compilation_batch, executable_row, require_open, result_row, schema_check, stored_result,
    NEW_DIGEST,
};

/// Stale evaluations and a result whose score is fully or partially populated.
async fn seed_scored_result(connection: &mut PgConnection, full: bool) {
    sqlx::raw_sql(AssertSqlSafe(
        "INSERT INTO evaluations (id, submission_id, dataset_id, testcase_id, outcome, text) \
         VALUES (500, 100, 20, 40, '1.0', ARRAY['en: right']::varchar[]), \
                (501, 100, 20, 41, '0.0', ARRAY['en: wrong']::varchar[])",
    ))
    .execute(&mut *connection)
    .await
    .expect("seeding stale evaluations");
    sqlx::raw_sql(AssertSqlSafe(
        "INSERT INTO submission_results (submission_id, dataset_id, compilation_outcome, \
            compilation_text, compilation_tries, evaluation_outcome, evaluation_tries, \
            score, score_details, scored_at, public_score, public_score_details, \
            ranking_score_details) \
         VALUES (100, 20, 'ok', ARRAY['old']::varchar[], 1, 'ok', 3, \
            12.5, '{\"score\": 12.5}', '2026-01-01 00:00:09', \
            7.25, '{\"public\": 7.25}', ARRAY['12.5']::varchar[])",
    ))
    .execute(&mut *connection)
    .await
    .expect("seeding a scored result");
    if !full {
        sqlx::raw_sql(AssertSqlSafe(
            "UPDATE submission_results SET score_details = NULL, public_score = NULL, \
                public_score_details = NULL, ranking_score_details = NULL \
             WHERE submission_id = 100 AND dataset_id = 20",
        ))
        .execute(&mut *connection)
        .await
        .expect("making the seeded score partial");
    }
}

#[derive(Debug, FromRow)]
struct StoredScore {
    score: Option<f64>,
    score_details: Option<String>,
    scored_at: Option<String>,
    public_score: Option<f64>,
    public_score_details: Option<String>,
    ranking_score_details: Option<Vec<String>>,
}

/// The score columns and stamp the object holds after the commit.
async fn stored_score(connection: &mut PgConnection) -> StoredScore {
    sqlx::query_as::<_, StoredScore>(
        "SELECT score, score_details::text AS score_details, \
                scored_at::text AS scored_at, public_score, \
                public_score_details::text AS public_score_details, ranking_score_details \
         FROM submission_results WHERE submission_id = $1 AND dataset_id = $2",
    )
    .bind(100)
    .bind(20)
    .fetch_one(connection)
    .await
    .expect("reading the stored score")
}

/// The number of evaluations left for the object after the commit.
async fn stored_evaluation_count(connection: &mut PgConnection) -> i64 {
    sqlx::query_scalar(
        "SELECT count(*) FROM evaluations WHERE submission_id = $1 AND dataset_id = $2",
    )
    .bind(100)
    .bind(20)
    .fetch_one(connection)
    .await
    .expect("counting the stored evaluations")
}

/// Assert five blank score fields and the stamp that survived the clear.
async fn assert_score_cleared(connection: &mut PgConnection) {
    let score = stored_score(connection).await;
    assert_eq!(score.score, None, "score is cleared");
    assert_eq!(score.score_details, None, "score details are cleared");
    assert_eq!(score.public_score, None, "public score is cleared");
    assert_eq!(
        score.public_score_details, None,
        "public details are cleared"
    );
    assert_eq!(
        score.ranking_score_details, None,
        "ranking details are cleared"
    );
    assert_eq!(score.scored_at.as_deref(), Some("2026-01-01 00:00:09"));
}

/// A recompilation drops stale evaluations and score fields but keeps the stamp.
#[tokio::test]
async fn a_compilation_clears_evaluations_and_score_but_keeps_scored_at() {
    let (mut base, mut connection, name) = require_open().await;
    seed_scored_result(&mut connection, true).await;

    let mut written = compilation_batch(vec![executable_row("new.bin", NEW_DIGEST)]);
    written.result = ResultRow {
        compilation_outcome: Some(CompilationOutcome::Ok),
        compilation_tries: 1,
        evaluation_tries: 0,
        ..result_row()
    };
    commit(&mut connection, &[written])
        .await
        .expect("committing a recompilation over a scored result");

    assert_eq!(
        stored_evaluation_count(&mut connection).await,
        0,
        "stale evaluations are invalidated"
    );
    let result = stored_result(&mut connection).await;
    assert_eq!(
        result.evaluation_outcome, None,
        "evaluation outcome is cleared"
    );
    assert_eq!(result.evaluation_tries, 0, "evaluation tries are cleared");
    assert_eq!(result.compilation_outcome.as_deref(), Some("ok"));
    assert_eq!(result.compilation_tries, 1);
    assert!(result.compilation_text.is_empty());
    assert_score_cleared(&mut connection).await;

    drop(connection);
    schema_check::drop_database(&mut base, &name).await;
}

/// A partial score is cleared too: invalidation does not depend on `scored()`.
#[tokio::test]
async fn a_compilation_clears_a_partial_score_but_keeps_scored_at() {
    let (mut base, mut connection, name) = require_open().await;
    seed_scored_result(&mut connection, false).await;
    let before = stored_score(&mut connection).await;
    assert_eq!(before.score, Some(12.5));
    assert_eq!(before.score_details, None, "the seeded score is partial");

    let written = compilation_batch(Vec::new());
    commit(&mut connection, &[written])
        .await
        .expect("compiling over a partial score");
    assert_score_cleared(&mut connection).await;

    drop(connection);
    schema_check::drop_database(&mut base, &name).await;
}
