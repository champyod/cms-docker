//! The submission search against a real server, and the pairs it refuses.
//!
//! RUN: CMS_DB_TEST_URL=postgres://cmsuser:***@127.0.0.1:5432/cmsdb_test \
//!        cargo test -p cms-db --test reads_submissions_live

use cms_db::{get_submissions, SearchError, Submission, SubmissionFilter, SubmissionId};
use sqlx::postgres::PgConnection;

// Each binary that includes these fixtures uses a subset of them.
#[allow(dead_code)]
#[path = "support/util_db.rs"]
mod util_db;
#[allow(dead_code)]
#[path = "support/util_search.rs"]
mod util_search;

use util_db::{open, skip, CONTEST, OTHER_CONTEST, PARTICIPATION, SHARED_TASK, TASK};
use util_search::{seed, FIRST_SUBMISSION, SECOND_SUBMISSION, THIRD_SUBMISSION};

#[tokio::test]
async fn a_submission_search_filters_by_every_criterion_it_takes() {
    let Some(url) = skip() else {
        return;
    };
    let mut connection = open(&url).await;
    seed(&mut connection).await;

    let all = get_submissions(&mut connection, &SubmissionFilter::default())
        .await
        .expect("every submission");
    assert_eq!(
        ids(&all),
        vec![FIRST_SUBMISSION, SECOND_SUBMISSION, THIRD_SUBMISSION]
    );
    assert!(all
        .iter()
        .all(|submission| submission.record.language.is_none() && submission.record.official));
    let third = all
        .iter()
        .find(|submission| submission.record.id == SubmissionId(THIRD_SUBMISSION))
        .expect("the third fixture submission");
    assert_eq!(third.opaque_id, 3, "the whole row, not the judging columns");
    assert_eq!(third.comment, "first line");

    assert_eq!(
        search(
            &mut connection,
            SubmissionFilter {
                contest_id: Some(CONTEST),
                ..SubmissionFilter::default()
            }
        )
        .await,
        vec![FIRST_SUBMISSION, SECOND_SUBMISSION]
    );
    assert_eq!(
        search(
            &mut connection,
            SubmissionFilter {
                contest_id: Some(OTHER_CONTEST),
                ..SubmissionFilter::default()
            }
        )
        .await,
        vec![THIRD_SUBMISSION]
    );
    assert_eq!(
        search(
            &mut connection,
            SubmissionFilter {
                task_id: Some(SHARED_TASK),
                ..SubmissionFilter::default()
            }
        )
        .await,
        vec![SECOND_SUBMISSION]
    );
    assert_eq!(
        search(
            &mut connection,
            SubmissionFilter {
                participation_id: Some(PARTICIPATION),
                ..SubmissionFilter::default()
            }
        )
        .await,
        vec![FIRST_SUBMISSION, SECOND_SUBMISSION]
    );
    assert_eq!(
        search(
            &mut connection,
            SubmissionFilter {
                submission_id: Some(SubmissionId(THIRD_SUBMISSION)),
                ..SubmissionFilter::default()
            }
        )
        .await,
        vec![THIRD_SUBMISSION]
    );
}

#[tokio::test]
async fn a_wider_criterion_beside_the_one_that_implies_it_is_refused() {
    let Some(url) = skip() else {
        return;
    };
    let mut connection = open(&url).await;
    seed(&mut connection).await;

    let refused = get_submissions(
        &mut connection,
        &SubmissionFilter {
            task_id: Some(TASK),
            contest_id: Some(CONTEST),
            ..SubmissionFilter::default()
        },
    )
    .await
    .expect_err("task_id imposes contest_id");

    assert!(matches!(
        refused,
        SearchError::Superfluous {
            field: "contest_id",
            implied_by: "task_id"
        }
    ));
}

/// The ids of a search's submissions, sorted.
async fn search(connection: &mut PgConnection, filter: SubmissionFilter) -> Vec<i32> {
    ids(&get_submissions(connection, &filter)
        .await
        .expect("the search"))
}

/// The ids of a search's submissions, sorted.
fn ids(submissions: &[Submission]) -> Vec<i32> {
    let mut ids: Vec<i32> = submissions
        .iter()
        .map(|submission| submission.record.id.0)
        .collect();
    ids.sort_unstable();
    ids
}
