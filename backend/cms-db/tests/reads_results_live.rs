//! The submission-result search against a real server, and the pair it refuses.
//!
//! RUN: CMS_DB_TEST_URL=postgres://cmsuser:***@127.0.0.1:5432/cmsdb_test \
//!        cargo test -p cms-db --test reads_results_live

use cms_db::{
    get_submission_results, DatasetId, ResultFilter, SearchError, SubmissionId, SubmissionResult,
};
use sqlx::postgres::PgConnection;

// Each binary that includes these fixtures uses a subset of them.
#[allow(dead_code)]
#[path = "support/util_db.rs"]
mod util_db;
#[allow(dead_code)]
#[path = "support/util_search.rs"]
mod util_search;

use util_db::{open, skip, CONTEST, OTHER_CONTEST, PARTICIPATION, SHARED_TASK, TASK};
use util_search::{
    seed, FIRST_DATASET, FIRST_SUBMISSION, FOURTH_DATASET, SECOND_DATASET, SECOND_SUBMISSION,
    THIRD_DATASET, THIRD_SUBMISSION,
};

#[tokio::test]
async fn a_result_search_filters_by_every_criterion_it_takes() {
    let Some(url) = skip() else {
        return;
    };
    let mut connection = open(&url).await;
    seed(&mut connection).await;

    let all = get_submission_results(&mut connection, &ResultFilter::default())
        .await
        .expect("every result");
    assert_eq!(
        result_ids(&all),
        vec![
            (FIRST_SUBMISSION, FIRST_DATASET),
            (FIRST_SUBMISSION, SECOND_DATASET),
            (SECOND_SUBMISSION, THIRD_DATASET),
            (THIRD_SUBMISSION, FOURTH_DATASET),
        ]
    );
    let scored = all
        .iter()
        .find(|result| result.submission_id == SubmissionId(FIRST_SUBMISSION))
        .expect("the scored fixture");
    assert_eq!(scored.score, Some(5.0));
    assert_eq!(scored.public_score, Some(3.0));

    let cases = [
        (
            ResultFilter {
                contest_id: Some(CONTEST),
                ..ResultFilter::default()
            },
            3,
        ),
        (
            ResultFilter {
                contest_id: Some(OTHER_CONTEST),
                ..ResultFilter::default()
            },
            1,
        ),
        (
            ResultFilter {
                task_id: Some(SHARED_TASK),
                ..ResultFilter::default()
            },
            1,
        ),
        (
            ResultFilter {
                participation_id: Some(PARTICIPATION),
                ..ResultFilter::default()
            },
            3,
        ),
        (
            ResultFilter {
                submission_id: Some(SubmissionId(FIRST_SUBMISSION)),
                ..ResultFilter::default()
            },
            2,
        ),
        (
            ResultFilter {
                dataset_id: Some(DatasetId(FIRST_DATASET)),
                ..ResultFilter::default()
            },
            1,
        ),
        (
            ResultFilter {
                submission_id: Some(SubmissionId(FIRST_SUBMISSION)),
                dataset_id: Some(DatasetId(FIRST_DATASET)),
                ..ResultFilter::default()
            },
            1,
        ),
    ];
    for (filter, expected) in cases {
        assert_eq!(
            count(&mut connection, filter).await,
            expected,
            "{filter:?} found the wrong number of results"
        );
    }
}

#[tokio::test]
async fn a_dataset_beside_the_task_it_implies_is_refused() {
    let Some(url) = skip() else {
        return;
    };
    let mut connection = open(&url).await;
    seed(&mut connection).await;

    let refused = get_submission_results(
        &mut connection,
        &ResultFilter {
            dataset_id: Some(DatasetId(FIRST_DATASET)),
            task_id: Some(TASK),
            ..ResultFilter::default()
        },
    )
    .await
    .expect_err("dataset_id imposes task_id");

    assert!(matches!(
        refused,
        SearchError::Superfluous {
            field: "task_id",
            implied_by: "dataset_id"
        }
    ));
}

/// How many results a search finds.
async fn count(connection: &mut PgConnection, filter: ResultFilter) -> usize {
    get_submission_results(connection, &filter)
        .await
        .expect("the search")
        .len()
}

/// The `(submission, dataset)` pairs of a search's results, sorted.
fn result_ids(results: &[SubmissionResult]) -> Vec<(i32, i32)> {
    let mut ids: Vec<(i32, i32)> = results
        .iter()
        .map(|result| (result.submission_id.0, result.dataset_id.0))
        .collect();
    ids.sort_unstable();
    ids
}
