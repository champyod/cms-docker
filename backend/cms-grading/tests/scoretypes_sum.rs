//! What `Sum` is worth: every testcase on its own, no subtasks, and no ranking column.
//!
//! The dataset is the same seven testcases, and the parameter is ten: the most a
//! submission can score is seventy, and the four public testcases are worth forty. The
//! figures are the reference's, over the same dataset its own tests build.

#[path = "scoretypes_helpers.rs"]
mod helpers;

use cms_grading::scoretypes::{format_score, ScoreDetails, Scored, SumRow};

use helpers::{score_type, submission, sum_rows, unevaluated};

/// `Sum` over the seven testcases, each worth ten.
fn sum() -> cms_grading::scoretypes::ScoreType {
    score_type("Sum", serde_json::json!(10))
}

#[test]
fn the_most_a_submission_can_score_is_the_parameter_once_per_testcase() {
    let max = sum().max_scores();
    assert_eq!(max.score, 70.0);
    assert_eq!(
        max.public_score, 40.0,
        "four of the seven testcases are public"
    );
    assert_eq!(
        max.headers,
        Vec::<String>::new(),
        "nothing is grouped, so a ranking table has no extra column"
    );
}

#[test]
fn every_testcase_is_worth_its_outcome_times_the_parameter() {
    let scored = score_mixed();
    assert_eq!(scored.score, 55.0);
    assert_eq!(scored.public_score, 25.0);
    assert_eq!(scored.ranking_details, Vec::<String>::new());
    assert_eq!(
        format_score(scored.score, 70.0, 4),
        "55 / 70",
        "the maximum is the sum of the weights, not a hundred"
    );
}

#[test]
fn a_testcase_is_marked_by_the_weight_it_earned() {
    let scored = score_mixed();
    let outcomes: Vec<&str> = sum_rows(&scored.details)
        .iter()
        .map(|row| match row {
            SumRow::Shown { outcome, .. } => outcome.as_str(),
            SumRow::Hidden { .. } => "hidden",
        })
        .collect();
    assert_eq!(
        outcomes,
        vec![
            "Correct",
            "Partially correct",
            "Not correct",
            "Correct",
            "Correct",
            "Correct",
            "Correct"
        ],
        "half of ten is worth half, and nothing is worth nothing"
    );
}

#[test]
fn a_contestant_sees_only_the_testcases_that_are_public() {
    let scored = score_mixed();
    let hidden: Vec<&str> = sum_rows(&scored.public_details)
        .iter()
        .filter_map(|row| match row {
            SumRow::Hidden { index } => Some(index.as_str()),
            SumRow::Shown { .. } => None,
        })
        .collect();
    assert_eq!(hidden, vec!["2_1", "3_0", "3_1"]);
    assert_eq!(
        sum_rows(&scored.public_details).len(),
        7,
        "a hidden testcase is still numbered, it just has no outcome"
    );
}

#[test]
fn an_unevaluated_submission_scores_nothing_and_ranks_nothing() {
    let scored = sum()
        .compute_score(&unevaluated())
        .expect("nothing is read from an unevaluated submission");
    assert_eq!(scored.score, 0.0);
    assert_eq!(scored.public_score, 0.0);
    assert_eq!(scored.details, ScoreDetails::Testcases(Vec::new()));
    assert_eq!(scored.public_details, ScoreDetails::Testcases(Vec::new()));
    assert_eq!(scored.ranking_details, Vec::<String>::new());
}

/// The submission the reference's `Sum` test scores: one correct testcase, one half, and
/// one that never answered.
fn score_mixed() -> Scored {
    sum()
        .compute_score(&submission(&[("0_0", 1.0), ("1_0", 0.5), ("1_1", 0.0)]))
        .expect("every testcase of the dataset is in the submission")
}
