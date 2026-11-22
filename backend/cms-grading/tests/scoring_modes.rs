//! What each score mode is worth over several submissions, transcribed from the reference.
//!
//! The three differ where it hurts: an unscored submission is absent from two of them and is
//! the number zero in the third when it is the last one sent. So each mode is asked about a
//! participation holding an unscored submission, and the tokened-last mode is asked about one
//! whose *last* submission is unscored — the case a port collapses when it filters the pending
//! rows out before choosing the last.

#[path = "scoring_helpers.rs"]
mod helpers;

use cms_grading::scoring::{max, max_subtask, max_tokened_last};

use helpers::{
    counted, empty_document, group_document, hidden_subtask, pending, subtask, sum_document,
};

#[test]
fn max_is_the_best_submission_and_an_unscored_one_adds_nothing() {
    let document = group_document(vec![subtask(0, 12.5)]);
    let contributions = [
        counted(5.0, &document, false),
        pending(false),
        counted(12.5, &document, true),
        counted(7.25, &document, false),
    ];

    assert_eq!(max(&contributions), 12.5);
}

#[test]
fn max_subtask_sums_each_subtasks_best_over_every_submission() {
    let first = group_document(vec![subtask(0, 10.5), subtask(1, 0.0)]);
    let second = group_document(vec![subtask(0, 5.0), subtask(1, 30.5)]);
    let contributions = [
        counted(10.5, &first, false),
        counted(35.5, &second, false),
        pending(false),
    ];

    assert_eq!(max_subtask(&contributions), 41.0);
}

#[test]
fn max_subtask_reads_a_document_without_subtasks_as_one_subtask() {
    let document = sum_document();

    assert_eq!(max_subtask(&[counted(20.0, &document, false)]), 20.0);
    assert_eq!(
        max_subtask(&[
            counted(20.0, &document, false),
            counted(15.0, &document, false)
        ]),
        20.0
    );
}

#[test]
fn max_subtask_ignores_a_submission_that_never_compiled() {
    let document = empty_document();

    assert_eq!(max_subtask(&[counted(0.0, &document, false)]), 0.0);
    assert_eq!(max_subtask(&[counted(20.0, &document, false)]), 20.0);
}

#[test]
fn max_subtask_reads_a_document_that_hides_a_subtasks_weight_as_one_subtask() {
    let document = group_document(vec![subtask(0, 10.5), hidden_subtask(1)]);

    assert_eq!(
        max_subtask(&[counted(41.0, &document, false)]),
        41.0,
        "the hidden weighting makes the whole document one subtask, not the visible part of it"
    );
}

#[test]
fn max_tokened_last_takes_the_best_tokened_submission_over_the_last() {
    let document = group_document(vec![subtask(0, 30.0)]);
    let contributions = [
        counted(30.0, &document, true),
        counted(10.0, &document, false),
    ];

    assert_eq!(max_tokened_last(&contributions), 30.0);
}

#[test]
fn max_tokened_last_takes_the_last_submission_when_it_beats_every_token() {
    let document = group_document(vec![subtask(0, 70.0)]);
    let contributions = [
        counted(30.0, &document, true),
        counted(70.0, &document, false),
    ];

    assert_eq!(max_tokened_last(&contributions), 70.0);
}

#[test]
fn max_tokened_last_reads_a_pending_last_submission_as_zero() {
    let document = group_document(vec![subtask(0, 50.0)]);
    let contributions = [counted(50.0, &document, false), pending(false)];

    assert_eq!(max_tokened_last(&contributions), 0.0);
}

#[test]
fn max_tokened_last_keeps_a_tokened_score_before_a_pending_last_submission() {
    let document = group_document(vec![subtask(0, 30.0)]);
    let contributions = [counted(30.0, &document, true), pending(true)];

    assert_eq!(max_tokened_last(&contributions), 30.0);
}
