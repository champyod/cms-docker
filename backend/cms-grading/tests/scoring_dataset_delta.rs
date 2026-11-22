//! What a dataset replacement reports, transcribed from the reference's `scoring.py:47`.
//!
//! One submission per thing a replacement can change: its score, its public score, its ranking
//! details, nothing at all, and the two halves of a result that only one dataset holds. A
//! submission whose columns all agree must not appear, and inside one that does, the columns
//! that agree must carry no value — that is what lets a caller read the list as "what to
//! restore" rather than as a rewrite of every result.

use std::collections::BTreeMap;

use cms_db::SubmissionId;
use cms_grading::scoring::{
    compute_changes_for_dataset, DatasetScores, ScoreColumns, SubmissionScoreDelta,
};

/// A result whose three columns are filled.
fn columns(score: f64, public_score: f64, ranking_details: &str) -> ScoreColumns {
    ScoreColumns {
        score: Some(score),
        public_score: Some(public_score),
        ranking_details: Some(vec![ranking_details.to_owned()]),
    }
}

/// One dataset's results, keyed by the submission they belong to.
fn dataset(task: i32, results: &[(i32, ScoreColumns)]) -> DatasetScores {
    let by_submission: BTreeMap<SubmissionId, ScoreColumns> = results
        .iter()
        .map(|(submission, columns)| (SubmissionId(*submission), columns.clone()))
        .collect();
    DatasetScores {
        task,
        by_submission,
    }
}

/// One expected delta, written as the reference's tuple reads.
fn delta(
    submission: i32,
    scores: (Option<f64>, Option<f64>),
    public_scores: (Option<f64>, Option<f64>),
    ranking_details: (Option<&str>, Option<&str>),
) -> SubmissionScoreDelta {
    SubmissionScoreDelta {
        submission: SubmissionId(submission),
        old_score: scores.0,
        new_score: scores.1,
        old_public_score: public_scores.0,
        new_public_score: public_scores.1,
        old_ranking_details: ranking_details.0.map(|details| vec![details.to_owned()]),
        new_ranking_details: ranking_details.1.map(|details| vec![details.to_owned()]),
    }
}

#[test]
fn only_the_submissions_a_replacement_would_change_are_reported() {
    let old = dataset(
        1,
        &[
            (1, columns(10.0, 4.0, "10")),
            (2, columns(10.0, 4.0, "10")),
            (3, columns(10.0, 4.0, "10")),
            (4, columns(10.0, 4.0, "10")),
            (5, columns(10.0, 4.0, "10")),
        ],
    );
    let new = dataset(
        1,
        &[
            (1, columns(12.0, 4.0, "12")),
            (2, columns(10.0, 5.0, "10")),
            (3, columns(10.0, 4.0, "10.0")),
            (4, columns(10.0, 4.0, "10")),
            (6, columns(7.0, 2.0, "7")),
        ],
    );

    assert_eq!(
        compute_changes_for_dataset(&old, &new),
        vec![
            delta(
                1,
                (Some(10.0), Some(12.0)),
                (None, None),
                (Some("10"), Some("12"))
            ),
            delta(2, (None, None), (Some(4.0), Some(5.0)), (None, None)),
            delta(3, (None, None), (None, None), (Some("10"), Some("10.0"))),
            delta(5, (Some(10.0), None), (Some(4.0), None), (Some("10"), None)),
            delta(6, (None, Some(7.0)), (None, Some(2.0)), (None, Some("7"))),
        ],
        "submission 4 is unchanged and must not be listed"
    );
}

#[test]
fn two_datasets_of_the_same_task_and_the_same_scores_report_nothing() {
    let old = dataset(1, &[(1, columns(10.0, 4.0, "10"))]);
    let new = dataset(1, &[(1, columns(10.0, 4.0, "10"))]);

    assert_eq!(
        compute_changes_for_dataset(&old, &new),
        Vec::<SubmissionScoreDelta>::new()
    );
}

#[test]
#[should_panic(expected = "Cannot compare datasets referring to different tasks.")]
fn datasets_of_different_tasks_are_refused() {
    let old = dataset(1, &[(1, columns(10.0, 4.0, "10"))]);
    let new = dataset(2, &[(1, columns(10.0, 4.0, "10"))]);

    let _ = compute_changes_for_dataset(&old, &new);
}
