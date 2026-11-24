//! The scoring queue's candidate query against a real server.
//!
//! RUN: CMS_DB_TEST_URL=postgres://cmsuser:***@127.0.0.1:5432/cmsdb_test \
//!        cargo test -p cms-db --test scoring_live

use chrono::NaiveDateTime;
use cms_db::{
    read_result_bundle, scoring_candidates, DatasetId, EvaluationOutcome, ScoringBundle,
    ScoringCandidate, SubmissionId,
};
use sqlx::postgres::PgConnection;
use sqlx::{AssertSqlSafe, Connection};

// Each test in this binary uses the same scratch schema.
#[allow(dead_code)]
#[path = "support/util_db.rs"]
mod util_db;

use util_db::{open, seed_datasets, skip};

const ACTIVE_DATASET: i32 = 20;
const AUTOJUDGE_DATASET: i32 = 21;
const EVALUATED_SUBMISSION: i32 = 302;
const FAILED_SUBMISSION: i32 = 301;

/// Run one constant statement the fixture owns.
async fn execute(connection: &mut PgConnection, statement: &'static str) {
    sqlx::raw_sql(AssertSqlSafe(statement))
        .execute(connection)
        .await
        .expect("seeding the scoring fixture");
}

/// The instant a fixture row carries.
fn at(second: u32) -> NaiveDateTime {
    NaiveDateTime::parse_from_str(
        &format!("2026-01-01 00:00:{second:02}"),
        "%Y-%m-%d %H:%M:%S",
    )
    .expect("a valid fixture timestamp")
}

/// The candidates the queue filter must return, independent of insertion order.
fn expected_candidates() -> Vec<ScoringCandidate> {
    vec![
        ScoringCandidate {
            submission_id: SubmissionId(EVALUATED_SUBMISSION),
            dataset_id: DatasetId(ACTIVE_DATASET),
            timestamp: at(1),
        },
        ScoringCandidate {
            submission_id: SubmissionId(FAILED_SUBMISSION),
            dataset_id: DatasetId(AUTOJUDGE_DATASET),
            timestamp: at(2),
        },
    ]
}

/// Judgeable, unscored, scored, non-judgeable, and not-yet-judgeable results.
async fn seed_candidates(connection: &mut PgConnection) {
    seed_datasets(connection).await;
    execute(
        connection,
        "INSERT INTO submissions (id, task_id, participation_id, timestamp) VALUES
            (300, 10, 100, '2026-01-01 00:00:00'),
            (302, 10, 100, '2026-01-01 00:00:01'),
            (301, 10, 100, '2026-01-01 00:00:02'),
            (303, 10, 100, '2026-01-01 00:00:03'),
            (304, 10, 100, '2026-01-01 00:00:04')",
    )
    .await;
    execute(
        connection,
        "INSERT INTO submission_results
            (submission_id, dataset_id, compilation_outcome, evaluation_outcome,
             score, score_details, public_score, public_score_details, ranking_score_details)
         VALUES
            (300, 20, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
            (302, 20, 'ok', 'ok', NULL, NULL, NULL, NULL, NULL),
            (301, 21, 'fail', NULL, NULL, NULL, NULL, NULL, NULL),
            (303, 22, 'ok', 'ok', NULL, NULL, NULL, NULL, NULL),
            (304, 20, 'ok', 'ok', 100, '{}'::jsonb, 100, '{}'::jsonb, ARRAY['100'])",
    )
    .await;
}

#[tokio::test]
async fn scoring_candidates_returns_only_judgeable_unscored_results_in_timestamp_order() {
    let Some(url) = skip() else {
        return;
    };
    let mut connection = open(&url).await;
    seed_candidates(&mut connection).await;

    let candidates = scoring_candidates(&mut connection)
        .await
        .expect("reading the scoring candidates");

    assert_eq!(candidates, expected_candidates());
}

/// One evaluated result, its two testcases, and their two runs.
async fn seed_result_bundle(connection: &mut PgConnection) -> ScoringCandidate {
    seed_datasets(connection).await;
    execute(
        connection,
        "INSERT INTO submissions (id, task_id, participation_id, timestamp)
         VALUES (310, 10, 100, '2026-01-01 00:00:01')",
    )
    .await;
    execute(
        connection,
        "INSERT INTO submission_results
            (submission_id, dataset_id, compilation_outcome, evaluation_outcome)
         VALUES (310, 20, 'ok', 'ok')",
    )
    .await;
    seed_bundle_cases(connection).await;
    ScoringCandidate {
        submission_id: SubmissionId(310),
        dataset_id: DatasetId(ACTIVE_DATASET),
        timestamp: at(1),
    }
}

/// The dataset's testcases and the candidate's runs on them.
async fn seed_bundle_cases(connection: &mut PgConnection) {
    execute(
        connection,
        "INSERT INTO testcases (id, dataset_id, codename, public, input, output) VALUES
            (30, 20, 'alpha', true,
             '0000000000000000000000000000000000000030',
             '0000000000000000000000000000000000000040'),
            (31, 20, 'beta', false,
             '0000000000000000000000000000000000000031',
             '0000000000000000000000000000000000000041')",
    )
    .await;
    execute(
        connection,
        "INSERT INTO evaluations
            (id, submission_id, dataset_id, testcase_id, outcome, text,
             execution_time, execution_memory)
         VALUES
            (40, 310, 20, 30, '1.5', ARRAY['right'], 0.25, 1024),
            (41, 310, 20, 31, '0.5', ARRAY['partial'], 0.5, 2048)",
    )
    .await;
}

#[tokio::test]
async fn read_result_bundle_gathers_every_record_the_score_core_reads_in_one_transaction() {
    let Some(url) = skip() else {
        return;
    };
    let mut connection = open(&url).await;
    let candidate = seed_result_bundle(&mut connection).await;
    let mut transaction = connection.begin().await.expect("beginning the transaction");

    let bundle: ScoringBundle = read_result_bundle(&mut transaction, &candidate)
        .await
        .expect("reading the scoring bundle");

    assert_bundle(&bundle, &candidate);
    transaction.commit().await.expect("committing the read");
}

/// Every entity and collection in the bundle carries the candidate's own data.
fn assert_bundle(bundle: &ScoringBundle, candidate: &ScoringCandidate) {
    assert_bundle_entities(bundle, candidate);
    assert_bundle_evaluations(bundle);
    assert_bundle_testcases(bundle);
}

/// The task, dataset, and result identify the candidate that was read.
fn assert_bundle_entities(bundle: &ScoringBundle, candidate: &ScoringCandidate) {
    assert_eq!(bundle.task.id, 10);
    assert_eq!(bundle.task.name.as_str(), "first");
    assert_eq!(bundle.task.active_dataset_id, Some(candidate.dataset_id));
    assert_eq!(bundle.dataset.id, candidate.dataset_id);
    assert_eq!(bundle.dataset.task_id, bundle.task.id);
    assert_eq!(bundle.dataset.score_type, "Sum");
    assert_eq!(bundle.dataset.score_type_parameters, "0");
    assert!(bundle.dataset.is_active);
    assert_eq!(bundle.result.submission_id, candidate.submission_id);
    assert_eq!(bundle.result.dataset_id, candidate.dataset_id);
    assert_eq!(
        bundle.result.evaluation_outcome,
        Some(EvaluationOutcome::Ok)
    );
}

/// Both runs are present in the statement's testcase order.
fn assert_bundle_evaluations(bundle: &ScoringBundle) {
    assert_eq!(
        bundle
            .evaluations
            .iter()
            .map(|run| (run.testcase_id, run.outcome.as_deref(), run.execution_time))
            .collect::<Vec<_>>(),
        vec![(30, Some("1.5"), Some(0.25)), (31, Some("0.5"), Some(0.5))]
    );
}

/// Every testcase carries its codename, visibility, and two stored digests.
fn assert_bundle_testcases(bundle: &ScoringBundle) {
    let mut testcases = bundle
        .testcases
        .iter()
        .map(|case| {
            (
                case.id,
                case.codename.as_str(),
                case.is_public,
                case.input.as_str(),
                case.output.as_str(),
            )
        })
        .collect::<Vec<_>>();
    testcases.sort_unstable();
    assert_eq!(
        testcases,
        vec![
            (
                30,
                "alpha",
                true,
                "0000000000000000000000000000000000000030",
                "0000000000000000000000000000000000000040",
            ),
            (
                31,
                "beta",
                false,
                "0000000000000000000000000000000000000031",
                "0000000000000000000000000000000000000041",
            ),
        ]
    );
}
