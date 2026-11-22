//! Which names a dataset may hold, and which parameters each name accepts.
//!
//! A score type is selected by the string in a dataset's `score_type` column, so the
//! registry is the one place a name becomes behaviour: a name it does not hold has to be
//! refused, because scoring a task with a type nobody chose publishes a number the dataset
//! never asked for. The refusals of the parameters are the reference's `ValueError`s, with
//! the subtask or the pattern named so an administrator knows which column to fix.

#[path = "scoretypes_helpers.rs"]
mod helpers;

use cms_grading::scoretypes::{ScoreType, ScoreTypeError};

use helpers::{groups, public_testcases, score_type, thresholds};

/// The four names, and what each one's parameters are.
fn of(name: &str) -> Result<ScoreType, ScoreTypeError> {
    let parameters = match name {
        "GroupMin" | "GroupMul" => groups(),
        "GroupThreshold" => thresholds(),
        _ => serde_json::json!(10),
    };
    ScoreType::of(name, &parameters, public_testcases())
}

#[test]
fn the_four_names_the_reference_registers_are_the_four_this_crate_has() {
    for name in ["Sum", "GroupMin", "GroupMul", "GroupThreshold"] {
        assert!(of(name).is_ok(), "{name} is a score type");
    }
}

#[test]
fn a_name_the_registry_does_not_hold_is_refused_by_name() {
    let error = ScoreType::of("GroupMax", &groups(), public_testcases())
        .expect_err("the registry holds four names and not this one");
    assert_eq!(
        error,
        ScoreTypeError::UnknownName {
            name: "GroupMax".to_owned()
        }
    );
    assert_eq!(
        error.to_string(),
        "the score type `GroupMax` is not one this worker has"
    );
}

#[test]
fn parameters_that_are_not_the_entries_a_group_holds_are_refused() {
    for parameters in [
        serde_json::json!(1),
        serde_json::json!([1]),
        serde_json::json!([[]]),
        serde_json::json!([[1]]),
        serde_json::json!([["a", "0_*"]]),
        serde_json::json!([[10, 1.5]]),
    ] {
        let error = ScoreType::of("GroupMin", &parameters, public_testcases())
            .expect_err("none of these is a list of [weight, selector] entries");
        assert!(
            matches!(
                error,
                ScoreTypeError::Parameters { .. } | ScoreTypeError::Group { .. }
            ),
            "{parameters} was refused with {error:?}"
        );
    }
}

#[test]
fn subtasks_that_select_their_testcases_two_ways_are_refused() {
    let mixed = serde_json::json!([[40, 10], [40, "1_*"]]);
    let error = ScoreType::of("GroupMin", &mixed, public_testcases())
        .expect_err("a list cannot count some subtasks and name others");
    assert_eq!(error, ScoreTypeError::MixedSelectors);
}

#[test]
fn a_pattern_that_matches_no_testcase_is_refused_by_the_pattern() {
    let unmatched = serde_json::json!([[100, "9_*"]]);
    let error = ScoreType::of("GroupMin", &unmatched, public_testcases())
        .expect_err("the dataset holds no 9_* testcase");
    assert_eq!(
        error,
        ScoreTypeError::UnmatchedPattern {
            pattern: "9_*".to_owned()
        }
    );
}

#[test]
fn a_threshold_of_the_wrong_type_is_refused_rather_than_compared() {
    let wrong = serde_json::json!([[100, 1, "high"]]);
    let error = ScoreType::of("GroupThreshold", &wrong, public_testcases())
        .expect_err("a threshold has to be a number");
    assert_eq!(
        error,
        ScoreTypeError::Group {
            name: "GroupThreshold",
            index: 0
        }
    );
}

#[test]
fn a_count_consumes_the_codenames_in_the_order_the_dataset_names_them() {
    let by_count = score_type("GroupMin", helpers::counted_groups()).max_scores();
    let by_pattern = score_type("GroupMin", groups()).max_scores();
    assert_eq!(
        by_count, by_pattern,
        "the two ways select the same testcases"
    );
    assert_eq!(by_count.public_score, 41.0);
}

#[test]
fn a_pattern_reads_the_list_of_codenames_a_loader_builds() {
    // The reference's TPS loader writes a subtask as its names, escaped and joined with `|`.
    let parameters = serde_json::json!([[50, "0_0|2_0"], [50, "1_0|1_1"]]);
    let max = score_type("GroupMin", parameters).max_scores();
    assert_eq!(max.score, 100.0);
    assert_eq!(
        max.public_score, 100.0,
        "both subtasks are made of public testcases alone"
    );
}

#[test]
fn a_pattern_reads_a_character_class_and_a_quantifier() {
    let parameters = serde_json::json!([[50, "[01]_."], [50, "2.*"]]);
    let scored = score_type("GroupMin", parameters)
        .compute_score(&helpers::submission(&[]))
        .expect("every selected testcase is in the submission");
    assert_eq!(
        scored.score, 100.0,
        "0_0, 1_0 and 1_1 in the first, 2_0 and 2_1 in the second"
    );
}

#[test]
fn a_pattern_reaching_past_what_this_crate_reads_is_refused_rather_than_misgrouped() {
    let parameters = serde_json::json!([[100, "(1|2)_*"]]);
    let error = ScoreType::of("GroupMin", &parameters, public_testcases())
        .expect_err("a group is not read here");
    assert_eq!(
        error,
        ScoreTypeError::UnsupportedPattern {
            pattern: "(1|2)_*".to_owned()
        }
    );
}
