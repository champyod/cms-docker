//! Scoring service transactions against a real server.
//!
//! RUN: CMS_DB_TEST_URL=postgres://cmsuser:***@127.0.0.1:5432/cmsdb_test \
//!        cargo test -p cms-scoring --test service_live

use chrono::NaiveDateTime;
use cms_db::{DatasetId, ResultFilter};
use serde_json::{json, Value};

#[path = "support/service_db.rs"]
mod service_db;
#[path = "support/service_schema.rs"]
mod service_schema;

use service_db::Fixture;

/// A fixed zone-less instant, as the score columns store it.
fn at(second: u32) -> NaiveDateTime {
    NaiveDateTime::parse_from_str(
        &format!("2026-01-01 00:00:{second:02}"),
        "%Y-%m-%d %H:%M:%S",
    )
    .expect("a valid fixture timestamp")
}

#[tokio::test]
async fn score_candidate_writes_and_replaces_every_score_column() {
    let Some(fixture) = Fixture::open("scoring_candidate_transaction").await else {
        return;
    };
    let candidate = fixture.seed_result(41, at(1), ["1.5", "0.5"]).await;

    let first = cms_scoring::score_candidate(fixture.session(), &candidate, at(10))
        .await
        .expect("scoring the evaluated result");
    assert_eq!(first.submission_id, candidate.submission_id);
    assert_eq!(first.dataset_id, candidate.dataset_id);
    assert_eq!(first.scored_at, Some(at(10)));
    let (details, public_details) = expected_details("Correct", "Partially correct");
    assert_stored_score(
        &fixture.stored_score(41).await,
        2.0,
        1.5,
        at(10),
        details,
        public_details,
    );

    fixture.set_outcomes(41, ["0.25", "0.75"]).await;
    let replacement = cms_scoring::score_candidate(fixture.session(), &candidate, at(11))
        .await
        .expect("replacing the score");
    assert_eq!(replacement.scored_at, Some(at(11)));
    let (details, public_details) = expected_details("Partially correct", "Partially correct");
    assert_stored_score(
        &fixture.stored_score(41).await,
        1.0,
        0.25,
        at(11),
        details,
        public_details,
    );
}

fn expected_details(alpha: &str, beta: &str) -> (Value, Value) {
    let details = json!([
        {"idx": "alpha", "outcome": alpha, "text": ["run"], "time": 0.25, "memory": 1024},
        {"idx": "beta", "outcome": beta, "text": ["run"], "time": 0.5, "memory": 1024}
    ]);
    let public_details = json!([
        {"idx": "alpha", "outcome": alpha, "text": ["run"], "time": 0.25, "memory": 1024},
        {"idx": "beta"}
    ]);
    (details, public_details)
}

#[tokio::test]
async fn invalidate_returns_only_scored_candidates_in_timestamp_order() {
    let Some(fixture) = Fixture::open("scoring_invalidation_transaction").await else {
        return;
    };
    let earlier = fixture.seed_result(41, at(1), ["1.5", "0.5"]).await;
    let later = fixture.seed_result(42, at(2), ["1.0", "1.0"]).await;
    fixture.seed_result(43, at(0), ["1.0", "0.0"]).await;
    cms_scoring::score_candidate(fixture.session(), &later, at(11))
        .await
        .expect("scoring the later submission");
    cms_scoring::score_candidate(fixture.session(), &earlier, at(10))
        .await
        .expect("scoring the earlier submission");

    let filter = ResultFilter {
        dataset_id: Some(DatasetId(service_db::DATASET_ID)),
        ..ResultFilter::default()
    };
    let invalidated = cms_scoring::invalidate(fixture.session(), &filter)
        .await
        .expect("invalidating the scored results");

    assert_eq!(invalidated, vec![earlier, later]);
    assert_invalidated(&fixture.stored_score(41).await, at(10));
    assert_invalidated(&fixture.stored_score(42).await, at(11));
    let unscored_score = fixture.stored_score(43).await;
    assert_blank_scores(&unscored_score);
    assert_eq!(unscored_score.scored_at, None);
    assert_eq!(
        cms_scoring::invalidate(fixture.session(), &filter)
            .await
            .expect("invalidating the already blank results"),
        Vec::new()
    );
}

fn assert_invalidated(actual: &service_db::StoredScore, scored_at: NaiveDateTime) {
    assert_blank_scores(actual);
    assert_eq!(actual.scored_at, Some(scored_at));
}

fn assert_blank_scores(actual: &service_db::StoredScore) {
    assert_eq!(actual.score, None);
    assert_eq!(actual.score_details, None);
    assert_eq!(actual.public_score, None);
    assert_eq!(actual.public_score_details, None);
    assert_eq!(actual.ranking_score_details, None);
}

fn assert_stored_score(
    actual: &service_db::StoredScore,
    score: f64,
    public_score: f64,
    scored_at: NaiveDateTime,
    details: Value,
    public_details: Value,
) {
    assert_eq!(actual.score, Some(score));
    assert_eq!(actual.public_score, Some(public_score));
    assert_eq!(actual.scored_at, Some(scored_at));
    assert_eq!(actual.ranking_score_details, Some(Vec::new()));
    let stored_details: Value = serde_json::from_str(
        actual
            .score_details
            .as_deref()
            .expect("the full details document"),
    )
    .expect("the full details document is JSON");
    assert_eq!(stored_details, details);
    let stored_public: Value = serde_json::from_str(
        actual
            .public_score_details
            .as_deref()
            .expect("the public details document"),
    )
    .expect("the public details document is JSON");
    assert_eq!(stored_public, public_details);
}
