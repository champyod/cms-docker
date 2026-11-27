//! Both invalidation levels against a live database and the RPC handler.
//!
//! RUN: source /home/ccyod/.hermes/cache/scratch/cms-test-p.env
//!        cargo test -p cms-evaluation --test invalidate_live -- --test-threads=1

#[path = "support/operation_db.rs"]
mod fixture;
#[path = "support/operation_schema.rs"]
mod schema;

use cms_db::Session;
use cms_evaluation::Evaluation;
use cms_proto::OperationKind;
use serde_json::json;
use sqlx::{AssertSqlSafe, FromRow};
use tokio::runtime::Handle;

use fixture::{Fixture, DATASET, SECRET, SUBMISSION};

/// A result with a compiled verdict, two evaluations and a stored score.
async fn seed_scored(session: &Session) {
    let mut transaction = session.begin().await.expect("beginning the seed");
    for statement in [
        format!(
            "INSERT INTO submission_results \
             (submission_id, dataset_id, compilation_outcome, evaluation_outcome, \
              compilation_tries, evaluation_tries, score, score_details, public_score, \
              public_score_details, ranking_score_details) \
             VALUES ({SUBMISSION}, {DATASET}, 'ok', 'ok', 1, 2, 9.5, '{{}}', 9.5, '{{}}', ARRAY['r'])"
        ),
        format!(
            "INSERT INTO evaluations (submission_id, dataset_id, testcase_id, outcome) \
             VALUES ({SUBMISSION}, {DATASET}, 60, 'ok'), ({SUBMISSION}, {DATASET}, 61, 'ok')"
        ),
    ] {
        sqlx::raw_sql(AssertSqlSafe(statement))
            .execute(transaction.connection())
            .await
            .expect("seeding a judged result");
    }
    transaction.commit().await.expect("committing the seed");
}

/// The stored verdict and score columns after an invalidation.
#[derive(Debug, FromRow)]
struct Stored {
    compilation_outcome: Option<String>,
    compilation_tries: i32,
    evaluation_outcome: Option<String>,
    evaluation_tries: i32,
    score: Option<f64>,
    score_details: Option<String>,
}

async fn stored(session: &Session) -> Stored {
    let mut transaction = session.begin().await.expect("beginning the read");
    let row = sqlx::query_as::<_, Stored>(
        "SELECT compilation_outcome, compilation_tries, evaluation_outcome, \
                evaluation_tries, score, score_details::text AS score_details \
         FROM submission_results WHERE submission_id = $1 AND dataset_id = $2",
    )
    .bind(SUBMISSION)
    .bind(DATASET)
    .fetch_one(transaction.connection())
    .await
    .expect("reading the stored verdict");
    transaction.commit().await.expect("committing the read");
    row
}

async fn count(session: &Session, table: &str) -> i64 {
    let mut transaction = session.begin().await.expect("beginning the count");
    let statement = format!("SELECT count(*) FROM {table} WHERE submission_id = {SUBMISSION}");
    let value: i64 = sqlx::query_scalar(AssertSqlSafe(statement))
        .fetch_one(transaction.connection())
        .await
        .expect("counting rows");
    transaction.commit().await.expect("committing the count");
    value
}

/// The kinds the planner put back on the queue, in pop order.
fn queued_kinds(evaluation: &Evaluation) -> Vec<OperationKind> {
    let mut kinds = Vec::new();
    while let Some((operation, _)) = evaluation.pop().expect("the queue is usable") {
        kinds.push(operation.operation.kind);
    }
    kinds
}

#[tokio::test]
async fn a_compilation_level_invalidation_clears_every_verdict() {
    let fixture = Fixture::required().await;
    seed_scored(&fixture.session()).await;
    let evaluation = Evaluation::new(
        fixture.session(),
        Handle::current(),
        None,
        Some(SECRET.to_owned()),
    );
    cms_evaluation::service::invalidate_submission_async(
        &json!({"level": "compilation", "submission_id": SUBMISSION}),
        &evaluation,
    )
    .await
    .expect("the invalidation succeeds");

    let row = stored(&fixture.session()).await;
    assert_eq!(row.compilation_outcome, None);
    assert_eq!(row.compilation_tries, 0);
    assert_eq!(row.evaluation_outcome, None);
    assert_eq!(row.evaluation_tries, 0);
    assert_eq!(row.score, None);
    assert_eq!(row.score_details, None);
    assert_eq!(count(&fixture.session(), "evaluations").await, 0);
    assert_eq!(count(&fixture.session(), "executables").await, 0);
    let kinds = queued_kinds(&evaluation);
    assert_eq!(
        kinds,
        vec![OperationKind::Compilation],
        "the planner starts again at compilation: {kinds:?}"
    );
}

#[tokio::test]
async fn an_evaluation_level_invalidation_keeps_the_compilation_half() {
    let fixture = Fixture::required().await;
    seed_scored(&fixture.session()).await;
    let evaluation = Evaluation::new(
        fixture.session(),
        Handle::current(),
        None,
        Some(SECRET.to_owned()),
    );
    cms_evaluation::service::invalidate_submission_async(
        &json!({"level": "evaluation", "submission_id": SUBMISSION}),
        &evaluation,
    )
    .await
    .expect("the invalidation succeeds");

    let row = stored(&fixture.session()).await;
    assert_eq!(row.compilation_outcome.as_deref(), Some("ok"));
    assert_eq!(row.compilation_tries, 1);
    assert_eq!(row.evaluation_outcome, None);
    assert_eq!(row.evaluation_tries, 0);
    assert_eq!(row.score, None);
    assert_eq!(count(&fixture.session(), "evaluations").await, 0);
    assert_eq!(count(&fixture.session(), "executables").await, 1);
    let kinds = queued_kinds(&evaluation);
    assert!(!kinds.contains(&OperationKind::Compilation), "{kinds:?}");
    assert_eq!(
        kinds
            .iter()
            .filter(|kind| **kind == OperationKind::Evaluation)
            .count(),
        2
    );
}

#[tokio::test]
async fn an_unknown_level_is_refused_by_name() {
    let fixture = Fixture::required().await;
    let evaluation = Evaluation::new(
        fixture.session(),
        Handle::current(),
        None,
        Some(SECRET.to_owned()),
    );
    let error = cms_evaluation::service::invalidate_submission_async(
        &json!({"level": "everything", "submission_id": SUBMISSION}),
        &evaluation,
    )
    .await
    .expect_err("an unknown level is refused");
    assert!(error.contains("everything"), "{error}");
}
