//! One full operation against real database and RPC hosts.
//!
//! RUN: source /home/ccyod/.hermes/cache/scratch/cms-test-p.env
//!        cargo test -p cms-evaluation --test operation_live -- --test-threads=1
//!
//! The worker is a scripted `cms-svc` host and ScoringService is a counting
//! host, so the effects are observed on the wire rather than inferred.

#[path = "../support/operation_db.rs"]
mod fixture;
mod host;
#[path = "../support/operation_schema.rs"]
mod schema;
mod support;

use cms_evaluation::WorkerDispatcher;
use cms_proto::OperationKind;

use fixture::{Fixture, DATASET, SECRET, SUBMISSION, USER_TEST};
use host::{Notification, Reply, ScoringHost, WorkerHost};
use support::{
    connection, evaluation, run_one, seed_evaluation, seed_result, stored_compilation,
    submission_operation, user_test_operation,
};

/// A digest the schema accepts, distinct from the worker's produced digest.
const NEW_DIGEST: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

#[tokio::test]
async fn one_compilation_writes_the_result_and_enqueues_the_evaluations() {
    let fixture = Fixture::required().await;
    let evaluation = evaluation(&fixture, None);
    let worker = WorkerHost::start(Reply::CompilationSuccess);
    let mut dispatcher = WorkerDispatcher::new(vec![worker.addr()], Some(SECRET.to_owned()));
    evaluation
        .enqueue(vec![submission_operation(
            OperationKind::Compilation,
            None,
            0,
        )])
        .expect("the compilation is queued");
    let mut scoring = None;
    run_one(&evaluation, &mut dispatcher, &mut scoring).await;

    assert_eq!(worker.hits(), 1, "one job group reached the worker");
    let mut connection = connection(&fixture).await;
    let stored = stored_compilation(&mut connection).await;
    assert_eq!(stored.outcome.as_deref(), Some("ok"));
    let digests: Vec<String> = sqlx::query_scalar(
        "SELECT digest FROM executables WHERE submission_id = $1 AND dataset_id = $2",
    )
    .bind(SUBMISSION)
    .bind(DATASET)
    .fetch_all(&mut connection)
    .await
    .expect("reading stored executables");
    assert_eq!(digests, vec![NEW_DIGEST.to_owned()]);
    assert_eq!(evaluation.queue_len(), 2, "both testcases were enqueued");
}

#[tokio::test]
async fn a_failed_compilation_notifies_scoring_service() {
    let fixture = Fixture::required().await;
    let scoring_host = ScoringHost::start();
    let evaluation = evaluation(&fixture, Some(scoring_host.addr().to_string()));
    let worker = WorkerHost::start(Reply::CompilationFailure);
    let mut dispatcher = WorkerDispatcher::new(vec![worker.addr()], Some(SECRET.to_owned()));
    evaluation
        .enqueue(vec![submission_operation(
            OperationKind::Compilation,
            None,
            0,
        )])
        .expect("the compilation is queued");
    let mut scoring = None;
    run_one(&evaluation, &mut dispatcher, &mut scoring).await;

    assert_eq!(
        scoring_host.calls(),
        vec![Notification {
            submission_id: SUBMISSION,
            dataset_id: DATASET,
        }],
        "the failure reached ScoringService on the wire"
    );
    let mut connection = connection(&fixture).await;
    assert_eq!(
        stored_compilation(&mut connection).await.outcome.as_deref(),
        Some("fail")
    );
}

#[tokio::test]
async fn a_failed_evaluation_is_requeued_by_the_same_planner() {
    let fixture = Fixture::required().await;
    let evaluation = evaluation(&fixture, None);
    seed_result(&fixture.session(), Some("ok"), 0).await;
    let worker = WorkerHost::start(Reply::WorkerFailure);
    let mut dispatcher = WorkerDispatcher::new(vec![worker.addr()], Some(SECRET.to_owned()));
    let planned = submission_operation(OperationKind::Evaluation, Some("alpha"), 0);
    evaluation
        .enqueue(vec![planned.clone()])
        .expect("the evaluation is queued");
    let mut scoring = None;
    run_one(&evaluation, &mut dispatcher, &mut scoring).await;

    let mut connection = connection(&fixture).await;
    let tries: i32 = sqlx::query_scalar(
        "SELECT evaluation_tries FROM submission_results \
         WHERE submission_id = $1 AND dataset_id = $2",
    )
    .bind(SUBMISSION)
    .bind(DATASET)
    .fetch_one(&mut connection)
    .await
    .expect("reading the try count");
    assert_eq!(tries, 1, "the failed evaluation was counted");
    let requeued = evaluation
        .pop()
        .expect("the queue is usable")
        .expect("the failed evaluation was re-enqueued");
    assert_eq!(requeued.0.operation.kind, OperationKind::Evaluation);
    assert_eq!(
        requeued.0.operation.testcase_codename.as_deref(),
        Some("alpha")
    );
}

#[tokio::test]
async fn a_third_compilation_failure_is_marked_terminal() {
    let fixture = Fixture::required().await;
    let scoring_host = ScoringHost::start();
    let evaluation = evaluation(&fixture, Some(scoring_host.addr().to_string()));
    seed_result(&fixture.session(), None, 2).await;
    let worker = WorkerHost::start(Reply::WorkerFailure);
    let mut dispatcher = WorkerDispatcher::new(vec![worker.addr()], Some(SECRET.to_owned()));
    evaluation
        .enqueue(vec![submission_operation(
            OperationKind::Compilation,
            None,
            2,
        )])
        .expect("the compilation is queued");
    let mut scoring = None;
    run_one(&evaluation, &mut dispatcher, &mut scoring).await;

    let mut connection = connection(&fixture).await;
    let stored = stored_compilation(&mut connection).await;
    assert_eq!(stored.tries, 3);
    assert_eq!(
        stored.outcome.as_deref(),
        Some("fail"),
        "the cap is terminal"
    );
    assert_eq!(
        scoring_host.calls().len(),
        1,
        "the terminal mark was reported"
    );
}

#[tokio::test]
async fn a_user_test_compilation_writes_its_result_and_executables() {
    let fixture = Fixture::required().await;
    let evaluation = evaluation(&fixture, None);
    let worker = WorkerHost::start(Reply::CompilationSuccess);
    let mut dispatcher = WorkerDispatcher::new(vec![worker.addr()], Some(SECRET.to_owned()));
    evaluation
        .enqueue(vec![user_test_operation()])
        .expect("the user-test compilation is queued");
    let mut scoring = None;
    run_one(&evaluation, &mut dispatcher, &mut scoring).await;

    let mut connection = connection(&fixture).await;
    let outcome: Option<String> = sqlx::query_scalar(
        "SELECT compilation_outcome FROM user_test_results \
         WHERE user_test_id = $1 AND dataset_id = $2",
    )
    .bind(USER_TEST)
    .bind(DATASET)
    .fetch_one(&mut connection)
    .await
    .expect("reading the user-test result");
    assert_eq!(outcome.as_deref(), Some("ok"));
    let digests: Vec<String> = sqlx::query_scalar(
        "SELECT digest FROM user_test_executables \
         WHERE user_test_id = $1 AND dataset_id = $2",
    )
    .bind(USER_TEST)
    .bind(DATASET)
    .fetch_all(&mut connection)
    .await
    .expect("reading the user-test executables");
    assert_eq!(digests, vec![NEW_DIGEST.to_owned()]);
    assert_eq!(
        evaluation.queue_len(),
        1,
        "the user-test evaluation was enqueued"
    );
}

#[tokio::test]
async fn a_successful_evaluation_notifies_scoring_service() {
    let fixture = Fixture::required().await;
    let scoring_host = ScoringHost::start();
    let evaluation = evaluation(&fixture, Some(scoring_host.addr().to_string()));
    seed_result(&fixture.session(), Some("ok"), 0).await;
    seed_evaluation(&fixture.session()).await;
    let worker = WorkerHost::start(Reply::EvaluationSuccess);
    let mut dispatcher = WorkerDispatcher::new(vec![worker.addr()], Some(SECRET.to_owned()));
    evaluation
        .enqueue(vec![submission_operation(
            OperationKind::Evaluation,
            Some("alpha"),
            0,
        )])
        .expect("the evaluation is queued");
    let mut scoring = None;
    run_one(&evaluation, &mut dispatcher, &mut scoring).await;

    assert_eq!(
        scoring_host.calls(),
        vec![Notification {
            submission_id: SUBMISSION,
            dataset_id: DATASET,
        }]
    );
    let mut connection = connection(&fixture).await;
    let outcomes: Vec<String> = sqlx::query_scalar(
        "SELECT outcome FROM evaluations          WHERE submission_id = $1 AND dataset_id = $2 ORDER BY testcase_id",
    )
    .bind(SUBMISSION)
    .bind(DATASET)
    .fetch_all(&mut connection)
    .await
    .expect("reading stored evaluations");
    assert_eq!(outcomes, vec!["ok".to_owned(), "ok".to_owned()]);
}
