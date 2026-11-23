//! The tally against a real server: the eight numbers, the shared-task contest join, and the total.
//!
//! RUN: CMS_DB_TEST_URL=postgres://cmsuser:***@127.0.0.1:15433/cmsdb_test \
//!        cargo test -p cms-api --test status_live

use cms_api::{submissions_status, StatusCounts};

#[path = "support/status_db.rs"]
mod status_db;

use status_db::{
    exec, open, seed_results, seed_submissions, skip, ResultSpec, ACTIVE_DATASET, CONTEST,
    INACTIVE_DATASET, OTHER_CONTEST, OTHER_PARTICIPATION, TASK,
};

#[tokio::test]
async fn two_submissions_no_bucket_classified_are_reported_as_compiling() {
    let Some(url) = skip() else {
        return;
    };
    let mut connection = open(&url).await;
    seed_submissions(&mut connection, &[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).await;
    seed_results(
        &mut connection,
        &[
            // Submission 1 has no result row at all; submission 2's only result is on a dataset
            // that is not the task's active one, so neither fits a bucket.
            ResultSpec {
                submission: 2,
                dataset: INACTIVE_DATASET,
                compilation: Some("ok"),
                compilation_tries: 1,
                evaluation: None,
                evaluation_tries: 0,
                scored: false,
            },
            compiling(3, 0),
            compiling(4, 1),
            ResultSpec {
                submission: 5,
                dataset: ACTIVE_DATASET,
                compilation: Some("fail"),
                compilation_tries: 1,
                evaluation: None,
                evaluation_tries: 0,
                scored: false,
            },
            evaluated(6),
            evaluated(7),
            evaluated(8),
            scored_but_for_the_score(9),
            scored(10),
        ],
    )
    .await;

    assert_eq!(
        submissions_status(&mut connection, None)
            .await
            .expect("the tally"),
        StatusCounts {
            compiling: 4,
            max_compilations: 0,
            compilation_fail: 1,
            evaluating: 3,
            max_evaluations: 0,
            scoring: 1,
            scored: 1,
            total: 10,
        },
        "the raw compiling count is 2; the two unclassified submissions make it 4"
    );
}

#[tokio::test]
async fn a_contest_counts_its_own_participants_on_a_task_both_contests_hold() {
    let Some(url) = skip() else {
        return;
    };
    let mut connection = open(&url).await;
    seed_submissions(&mut connection, &[1]).await;
    exec(
        &mut connection,
        &format!(
            "INSERT INTO submissions (id, task_id, participation_id) VALUES (2, {TASK}, {OTHER_PARTICIPATION})"
        ),
    )
    .await;
    seed_results(
        &mut connection,
        &[
            ResultSpec {
                submission: 1,
                dataset: ACTIVE_DATASET,
                compilation: Some("fail"),
                compilation_tries: 1,
                evaluation: None,
                evaluation_tries: 0,
                scored: false,
            },
            scored(2),
        ],
    )
    .await;

    assert_eq!(
        submissions_status(&mut connection, Some(CONTEST))
            .await
            .expect("the contest's tally"),
        StatusCounts {
            compilation_fail: 1,
            total: 1,
            ..StatusCounts::default()
        },
        "contest 1 owns submission 1 only"
    );
    assert_eq!(
        submissions_status(&mut connection, Some(OTHER_CONTEST))
            .await
            .expect("the other contest's tally"),
        StatusCounts {
            scored: 1,
            total: 1,
            ..StatusCounts::default()
        },
        "the task is shared, so the submission's participation decides its contest"
    );
    assert_eq!(
        submissions_status(&mut connection, None)
            .await
            .expect("every contest's tally"),
        StatusCounts {
            compilation_fail: 1,
            scored: 1,
            total: 2,
            ..StatusCounts::default()
        }
    );
}

#[tokio::test]
async fn the_total_counts_submissions_and_not_their_result_rows() {
    let Some(url) = skip() else {
        return;
    };
    let mut connection = open(&url).await;
    seed_submissions(&mut connection, &[1, 2, 3]).await;
    seed_results(
        &mut connection,
        &[
            // Submission 1 has no result; 2 has one on each dataset; 3 only on the inactive one.
            ResultSpec {
                submission: 2,
                dataset: ACTIVE_DATASET,
                compilation: Some("fail"),
                compilation_tries: 1,
                evaluation: None,
                evaluation_tries: 0,
                scored: false,
            },
            ResultSpec {
                submission: 2,
                dataset: INACTIVE_DATASET,
                compilation: Some("ok"),
                compilation_tries: 0,
                evaluation: Some("ok"),
                evaluation_tries: 0,
                scored: true,
            },
            ResultSpec {
                submission: 3,
                dataset: INACTIVE_DATASET,
                compilation: Some("ok"),
                compilation_tries: 0,
                evaluation: Some("ok"),
                evaluation_tries: 0,
                scored: true,
            },
        ],
    )
    .await;

    assert_eq!(
        submissions_status(&mut connection, None)
            .await
            .expect("the tally"),
        StatusCounts {
            compiling: 2,
            compilation_fail: 1,
            total: 3,
            ..StatusCounts::default()
        },
        "three submissions, not four result rows, and only the active dataset is classified"
    );
}

/// A result that compiled and has not been evaluated, with `tries` compilation failures behind it.
fn evaluated(submission: i32) -> ResultSpec {
    ResultSpec {
        submission,
        dataset: ACTIVE_DATASET,
        compilation: Some("ok"),
        compilation_tries: 0,
        evaluation: None,
        evaluation_tries: 0,
        scored: false,
    }
}

/// A submission whose compilation has not ended, with `tries` failures behind it.
fn compiling(submission: i32, tries: i32) -> ResultSpec {
    ResultSpec {
        submission,
        dataset: ACTIVE_DATASET,
        compilation: None,
        compilation_tries: tries,
        evaluation: None,
        evaluation_tries: 0,
        scored: false,
    }
}

/// A result that evaluated without a score written: the scoring bucket.
fn scored_but_for_the_score(submission: i32) -> ResultSpec {
    ResultSpec {
        submission,
        dataset: ACTIVE_DATASET,
        compilation: Some("ok"),
        compilation_tries: 0,
        evaluation: Some("ok"),
        evaluation_tries: 0,
        scored: false,
    }
}

/// A result holding all five score columns.
fn scored(submission: i32) -> ResultSpec {
    ResultSpec {
        submission,
        dataset: ACTIVE_DATASET,
        compilation: Some("ok"),
        compilation_tries: 0,
        evaluation: Some("ok"),
        evaluation_tries: 0,
        scored: true,
    }
}
