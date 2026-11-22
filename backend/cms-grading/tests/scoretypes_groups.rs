//! What the three subtask score types are worth, on the dataset the reference's own
//! score type tests use.
//!
//! Every figure here is transcribed from `src/cmstestsuite/unit_tests/grading/scoretypes/`
//! and from the reference implementation run over the same seven testcases: 10.5 for the
//! first subtask, 30.5 for the second, 59 for the third, four of the seven testcases
//! public. What the numbers are rather than what shape the answer has is the point, since
//! a shape that is right and an arithmetic that is not publishes a wrong score.

#[path = "scoretypes_helpers.rs"]
mod helpers;

use cms_grading::scoretypes::{Row, ScoreDetails, ScoreTypeError, Scored, Subtask};

use helpers::{
    counted_groups, entries, groups, is_unscored, rows, score_type, submission, subtask,
    thresholds, unevaluated,
};

#[test]
fn the_most_a_submission_can_score_is_its_weights_summed_and_the_public_part_of_it() {
    for parameters in [groups(), counted_groups()] {
        let max = score_type("GroupMin", parameters).max_scores();
        assert_eq!(max.score, 100.0);
        assert_eq!(
            max.public_score, 41.0,
            "0_0, 1_0 and 1_1 are the public ones"
        );
        assert_eq!(
            max.headers,
            vec!["Subtask 0 (10.5)", "Subtask 1 (30.5)", "Subtask 2 (59)"]
        );
    }

    let max = score_type("GroupThreshold", thresholds()).max_scores();
    assert_eq!(max.score, 100.0);
    assert_eq!(
        max.public_score, 10.5,
        "only the second subtask is all public"
    );
    assert_eq!(
        max.headers,
        vec![
            "Subtask 0 (0)",
            "Subtask 1 (10.5)",
            "Subtask 2 (30.5)",
            "Subtask 3 (59)"
        ]
    );
}

#[test]
fn group_min_earns_a_subtask_its_smallest_outcome() {
    let scored = score_one("GroupMin", &[("1_1", 0.5)]);
    assert_eq!(scored.score, 84.75);
    assert_eq!(scored.public_score, 25.75);
    assert_eq!(scored.ranking_details, vec!["10.5", "15.25", "59"]);
    assert_eq!(
        subtask(&scored.details, 1),
        (0.5, 15.25, 30.5),
        "half of 30.5 is 15.25"
    );
}

#[test]
fn group_mul_earns_a_subtask_the_product_of_its_outcomes() {
    let scored = score_one("GroupMul", &[("1_0", 0.5), ("1_1", 0.5)]);
    assert_eq!(scored.score, 77.125);
    assert_eq!(scored.public_score, 18.125);
    assert_eq!(scored.ranking_details, vec!["10.5", "7.625", "59"]);
    assert_eq!(
        subtask(&scored.details, 1),
        (0.25, 7.625, 30.5),
        "a quarter of 30.5 is 7.625"
    );
}

#[test]
fn a_partially_scored_subtask_earns_its_fraction_of_its_weight() {
    let scored = score_one("GroupMin", &[("2_0", 0.25)]);
    assert_eq!(scored.score, 55.75);
    assert_eq!(
        scored.public_score, 41.0,
        "a subtask with a hidden testcase adds nothing to the public score"
    );
    assert_eq!(scored.ranking_details, vec!["10.5", "30.5", "14.75"]);
    assert_eq!(subtask(&scored.details, 2), (0.25, 14.75, 59.0));
}

#[test]
fn a_contestant_sees_a_zero_for_a_subtask_they_cannot_see_all_of() {
    let scored = score_one("GroupMin", &[("2_0", 0.25)]);
    assert!(is_unscored(&scored.public_details, 2));
    assert_eq!(
        rows(&scored.public_details, 2).len(),
        2,
        "the hidden testcase is still numbered, it just has no outcome"
    );
    assert!(
        !is_unscored(&scored.details, 2),
        "the administrator sees it"
    );
}

#[test]
fn group_threshold_earns_the_weight_at_its_threshold_and_not_above_it() {
    let at = score_one("GroupThreshold", &[("1_0", 10.0), ("1_1", 10.0)]);
    assert_eq!(at.score, 100.0);
    assert_eq!(subtask(&at.details, 1), (1.0, 10.5, 10.5));

    let over = score_one("GroupThreshold", &[("1_1", 10.5)]);
    assert_eq!(over.score, 89.5);
    assert_eq!(over.public_score, 0.0);
    assert_eq!(over.ranking_details, vec!["0", "0", "30.5", "59"]);
    assert_eq!(subtask(&over.details, 1), (0.0, 0.0, 10.5));
}

#[test]
fn group_threshold_does_not_earn_the_weight_for_an_outcome_of_zero() {
    let zero = score_one("GroupThreshold", &[("1_1", 0.0)]);
    assert_eq!(
        zero.score, 89.5,
        "zero is what a run that never answered is reported with"
    );
    assert_eq!(subtask(&zero.details, 1), (0.0, 0.0, 10.5));
}

#[test]
fn a_subtask_worth_nothing_still_says_whether_it_passed() {
    let scored = score_one("GroupThreshold", &[]);
    assert_eq!(
        subtask(&scored.details, 0),
        (0.0, 0.0, 0.0),
        "the fraction is kept so a zero-weight subtask is not undefined"
    );
}

#[test]
fn an_unevaluated_submission_ranks_as_one_zero_per_subtask() {
    let scored = score_type("GroupMin", groups())
        .compute_score(&unevaluated())
        .expect("nothing is read from an unevaluated submission");
    assert_eq!(scored.score, 0.0);
    assert_eq!(scored.public_score, 0.0);
    assert_eq!(
        scored.ranking_details,
        vec!["0", "0", "0"],
        "one column per subtask, so the ranking table stays aligned"
    );
    assert_eq!(scored.details, ScoreDetails::Subtasks(Vec::new()));
}

#[test]
fn a_testcase_the_result_does_not_hold_is_refused_rather_than_scored_as_zero() {
    let mut submission = submission(&[]);
    submission.testcases.retain(|entry| entry.codename != "1_1");
    let error = score_type("GroupMin", groups())
        .compute_score(&submission)
        .expect_err("the second subtask selects 1_1");
    assert_eq!(
        error,
        ScoreTypeError::MissingEvaluation {
            codename: "1_1".to_owned()
        }
    );
}

#[test]
fn a_hidden_testcase_has_no_outcome_in_the_contestants_document() {
    let scored = score_one("GroupMin", &[]);
    assert_eq!(
        &rows(&scored.public_details, 2)[1],
        &Row::Hidden {
            index: "2_1".to_owned()
        }
    );
    assert!(
        matches!(&rows(&scored.details, 2)[1], Row::Shown(_)),
        "an administrator is shown the outcome of a testcase a contestant is not"
    );
}

#[test]
fn the_two_documents_of_a_fully_public_subtask_are_the_same() {
    let scored = score_one("GroupMin", &[]);
    let private = entries(&scored.details);
    let public = entries(&scored.public_details);
    assert_eq!(private[0], public[0]);
    assert_eq!(private[1], public[1]);
    assert!(
        matches!(&public[2], Subtask::Unscored { .. }),
        "the third subtask holds a testcase a contestant cannot see"
    );
}

/// One submission scored by the score type of that name.
fn score_one(name: &str, outcomes: &[(&str, f64)]) -> Scored {
    let parameters = if name == "GroupThreshold" {
        thresholds()
    } else {
        groups()
    };
    score_type(name, parameters)
        .compute_score(&submission(outcomes))
        .expect("every testcase the parameters select is in the submission")
}
