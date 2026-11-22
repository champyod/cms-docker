//! The score a participation is ranked on, transcribed from the reference's `scoring.py:106`.
//!
//! The three flags are asked separately over the same participation because each reads a
//! different column or a different set of submissions, and a port that collapsed two of them
//! would still produce a plausible number: `public` reads `public_score`, `only_tokened` drops
//! submissions whose `score` a token did not buy, and `is_pending` is about the participation
//! rather than the number. All three are pinned below on a fixture where they give three
//! different answers.

#[path = "scoring_helpers.rs"]
mod helpers;

use cms_db::ScoreMode;
use cms_grading::scoring::{task_score, ScoreOptions, Submission, TaskScore, TaskSettings};

use helpers::{group_document, pending_submission, submission, subtask, tokened};

/// The two task columns a score reads.
fn settings(score_mode: ScoreMode, score_precision: u32) -> TaskSettings {
    TaskSettings {
        score_mode,
        score_precision,
    }
}

/// The score of one participation under `max` at two decimal places.
fn score_max(submissions: &[Submission<'_>], options: ScoreOptions) -> TaskScore {
    task_score(submissions, settings(ScoreMode::Max, 2), options)
}

#[test]
fn public_reads_the_public_column_and_only_tokened_the_full_one() {
    let document = group_document(vec![subtask(0, 12.5)]);
    let submissions = [
        tokened(1, 9.0, 2.0, &document),
        submission(3, 12.5, 4.0, &document),
        pending_submission(4),
    ];

    assert_eq!(score_max(&submissions, ScoreOptions::default()).score, 12.5);
    assert_eq!(
        score_max(
            &submissions,
            ScoreOptions {
                public: true,
                ..ScoreOptions::default()
            }
        )
        .score,
        4.0,
        "the public column of both scored submissions, not the tokened one's score"
    );
    assert_eq!(
        score_max(
            &submissions,
            ScoreOptions {
                only_tokened: true,
                ..ScoreOptions::default()
            }
        )
        .score,
        9.0
    );
}

#[test]
fn a_participation_with_no_official_submission_scores_zero_and_has_nothing_pending() {
    let document = group_document(vec![subtask(0, 9.0)]);
    let unofficial = [Submission {
        official: false,
        ..submission(1, 9.0, 9.0, &document)
    }];
    let nothing = TaskScore {
        score: 0.0,
        is_pending: false,
    };

    assert_eq!(score_max(&[], ScoreOptions::default()), nothing);
    assert_eq!(score_max(&unofficial, ScoreOptions::default()), nothing);
}

#[test]
fn an_unscored_non_official_submission_does_not_make_the_participation_pending() {
    let document = group_document(vec![subtask(0, 3.0)]);
    let submissions = [
        Submission {
            official: false,
            ..pending_submission(1)
        },
        submission(2, 3.0, 3.0, &document),
    ];

    assert_eq!(
        score_max(&submissions, ScoreOptions::default()),
        TaskScore {
            score: 3.0,
            is_pending: false
        }
    );
}

#[test]
fn a_pending_submission_is_reported_without_lowering_the_max() {
    let document = group_document(vec![subtask(0, 4.0)]);
    let submissions = [submission(1, 4.0, 4.0, &document), pending_submission(2)];

    assert_eq!(
        score_max(&submissions, ScoreOptions::default()),
        TaskScore {
            score: 4.0,
            is_pending: true
        }
    );
}

#[test]
fn only_tokened_leaves_out_a_scored_submission_no_token_was_played_on() {
    let document = group_document(vec![subtask(0, 12.5)]);
    let submissions = [
        tokened(1, 9.0, 9.0, &document),
        submission(3, 12.5, 4.0, &document),
    ];

    assert_eq!(
        score_max(
            &submissions,
            ScoreOptions {
                only_tokened: true,
                ..ScoreOptions::default()
            }
        ),
        TaskScore {
            score: 9.0,
            is_pending: false
        },
        "a submission left out for its token is not pending: its score is known"
    );
}

#[test]
fn max_tokened_last_reads_the_submissions_in_timestamp_order_not_the_order_they_arrive() {
    let document = group_document(vec![subtask(0, 70.0)]);
    let submissions = [
        submission(2, 70.0, 70.0, &document),
        tokened(1, 30.0, 30.0, &document),
    ];

    assert_eq!(
        task_score(
            &submissions,
            settings(ScoreMode::MaxTokenedLast, 2),
            ScoreOptions::default()
        ),
        TaskScore {
            score: 70.0,
            is_pending: false
        }
    );
}

#[test]
fn max_tokened_last_reads_a_pending_last_submission_as_zero() {
    let document = group_document(vec![subtask(0, 50.0)]);
    let submissions = [submission(1, 50.0, 50.0, &document), pending_submission(2)];

    assert_eq!(
        task_score(
            &submissions,
            settings(ScoreMode::MaxTokenedLast, 2),
            ScoreOptions::default()
        ),
        TaskScore {
            score: 0.0,
            is_pending: true
        }
    );
}

#[test]
fn rounded_rounds_at_the_tasks_precision_and_a_tie_goes_to_even() {
    let document = group_document(vec![subtask(0, 2.25)]);
    let rounded = |score: f64| {
        task_score(
            &[submission(1, score, score, &document)],
            settings(ScoreMode::Max, 1),
            ScoreOptions {
                rounded: true,
                ..ScoreOptions::default()
            },
        )
        .score
    };

    assert_eq!(
        rounded(2.25),
        2.2,
        "2.25 ties to even, where a plain round gives 2.3"
    );
    assert_eq!(rounded(2.35), 2.4);
    assert_eq!(
        task_score(
            &[submission(1, 2.25, 2.25, &document)],
            settings(ScoreMode::Max, 1),
            ScoreOptions::default()
        )
        .score,
        2.25
    );
}

#[test]
#[should_panic(
    expected = "Requested public task score restricted to tokened submissions. This is a programming error: users have access to all public scores regardless of token status."
)]
fn a_public_score_restricted_to_tokened_submissions_is_refused() {
    let document = group_document(vec![subtask(0, 1.0)]);
    // The refusal is the assertion: the call panics rather than returning a score.
    let _ = score_max(
        &[submission(1, 1.0, 1.0, &document)],
        ScoreOptions {
            public: true,
            only_tokened: true,
            rounded: false,
        },
    );
}
