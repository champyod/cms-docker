//! The scoring RPC context against a real database.
//!
//! RUN: CMS_DB_TEST_URL=postgres://cmsuser:***@127.0.0.1:5432/cmsdb_test \
//!        cargo test -p cms-scoring --test api_live

use std::sync::Arc;

use cms_scoring::api::Scoring;
use serde_json::{json, Value};

#[path = "support/service_db.rs"]
mod service_db;
#[path = "support/service_schema.rs"]
mod service_schema;

use service_db::Fixture;

#[tokio::test]
async fn new_evaluation_enqueues_once_per_submission_and_dataset() {
    let fixture = Fixture::required("scoring_api_enqueue").await;
    let scoring = context(&fixture);

    assert_eq!(
        cms_scoring::api::new_evaluation(&json!({"submission_id": 41, "dataset_id": 9}), &scoring)
            .expect("the first request is accepted"),
        Value::Null
    );
    assert_eq!(
        cms_scoring::api::new_evaluation(&json!({"submission_id": 41, "dataset_id": 9}), &scoring)
            .expect("the duplicate request is accepted"),
        Value::Null
    );
    assert_eq!(scoring.queue_len(), 1);

    cms_scoring::api::new_evaluation(&json!({"submission_id": 41, "dataset_id": 10}), &scoring)
        .expect("another dataset is a distinct operation");
    assert_eq!(scoring.queue_len(), 2);
}

#[tokio::test]
async fn invalidate_submission_refuses_a_superfluous_filter_by_name() {
    let fixture = Fixture::required("scoring_api_filter").await;
    let scoring = context(&fixture);

    let refusal =
        cms_scoring::api::invalidate_submission(&json!({"dataset_id": 9, "task_id": 7}), &scoring)
            .expect_err("a dataset already implies its task");

    assert_eq!(refusal, "task_id is superfluous if dataset_id is given");
    assert_eq!(scoring.queue_len(), 0);
}

#[tokio::test]
async fn invalidate_submission_commits_the_clear_then_enqueues_the_candidate() {
    let fixture = Fixture::required("scoring_api_invalidate").await;
    let candidate = fixture.seed_result(41, at(1), ["1.5", "0.5"]).await;
    cms_scoring::score_candidate(fixture.session(), &candidate, at(10))
        .await
        .expect("the result starts fully scored");
    let scoring = context(&fixture);
    let request = json!({"submission_id": 41, "dataset_id": 9});

    assert_eq!(
        invalidate(request.clone(), Arc::clone(&scoring))
            .await
            .expect("the scored result is invalidated"),
        Value::Null
    );
    let stored = fixture.stored_score(41).await;
    assert_eq!(stored.score, None);
    assert_eq!(stored.score_details, None);
    assert_eq!(stored.scored_at, Some(at(10)));
    assert_eq!(stored.public_score, None);
    assert_eq!(stored.public_score_details, None);
    assert_eq!(stored.ranking_score_details, None);
    assert_eq!(scoring.queue_len(), 1);

    invalidate(request, Arc::clone(&scoring))
        .await
        .expect("an already invalidated result is a successful no-op");
    assert_eq!(scoring.queue_len(), 1);
}

fn context(fixture: &Fixture) -> Arc<Scoring> {
    Arc::new(Scoring::new(
        fixture.shared_session(),
        tokio::runtime::Handle::current(),
        None,
        None,
    ))
}

async fn invalidate(request: Value, scoring: Arc<Scoring>) -> Result<Value, String> {
    tokio::task::spawn_blocking(move || cms_scoring::api::invalidate_submission(&request, &scoring))
        .await
        .expect("the blocking RPC handler finishes")
}

fn at(second: u32) -> chrono::NaiveDateTime {
    chrono::NaiveDateTime::parse_from_str(
        &format!("2026-01-01 00:00:{second:02}"),
        "%Y-%m-%d %H:%M:%S",
    )
    .expect("a valid fixture timestamp")
}
