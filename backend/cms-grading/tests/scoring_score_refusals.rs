//! The malformed or incomplete inputs the scoring core refuses.

#[path = "scoring_score_helpers.rs"]
mod helpers;

use cms_grading::scoretypes::ScoreTypeError;
use cms_grading::scoring::ScoringError;

use helpers::Fixture;

#[test]
fn a_missing_evaluation_is_refused_by_its_testcase_id() {
    let mut fixture = Fixture::new("Sum", "10");
    fixture.evaluations.remove(1);

    let error = fixture
        .score()
        .expect_err("the dataset holds a testcase with no evaluation");

    assert!(
        matches!(error, ScoringError::MissingEvaluation { testcase_id: 4 }),
        "the refusal must name the testcase, not a codename: {error}"
    );
}

#[test]
fn a_malformed_outcome_is_refused_instead_of_scored_as_zero() {
    let mut fixture = Fixture::new("Sum", "10");
    fixture.evaluations[0].outcome = Some("not-a-number".to_string());

    let error = fixture
        .score()
        .expect_err("the grader outcome is not a number");

    match error {
        ScoringError::MalformedOutcome {
            testcase_id,
            outcome,
            ..
        } => {
            assert_eq!(testcase_id, 3);
            assert_eq!(outcome, "not-a-number");
        }
        other => panic!("the malformed outcome was not refused: {other}"),
    }
}

#[test]
fn a_missing_outcome_is_refused_instead_of_scored_as_zero() {
    let mut fixture = Fixture::new("Sum", "10");
    fixture.evaluations[0].outcome = None;

    let error = fixture
        .score()
        .expect_err("the grader left no outcome to score");

    assert!(
        matches!(error, ScoringError::MissingOutcome { testcase_id: 3 }),
        "the refusal must name the testcase: {error}"
    );
}

#[test]
fn an_evaluation_outside_the_dataset_is_refused() {
    let mut fixture = Fixture::new("Sum", "10");
    fixture.evaluations[0].testcase_id = 999;

    let error = fixture
        .score()
        .expect_err("the evaluation names a testcase the dataset does not hold");

    assert!(
        matches!(error, ScoringError::UnknownTestcase { testcase_id: 999 }),
        "the refusal must name the unknown testcase: {error}"
    );
}

#[test]
fn an_unknown_score_type_is_refused() {
    let fixture = Fixture::new("Unknown", "10");

    let error = fixture
        .score()
        .expect_err("the dataset names a score type this crate does not implement");

    assert!(
        matches!(
            error,
            ScoringError::ScoreType(ScoreTypeError::UnknownName { ref name }) if name == "Unknown"
        ),
        "the refusal must name the unknown score type: {error}"
    );
}

#[test]
fn malformed_score_parameters_are_refused() {
    let fixture = Fixture::new("Sum", "{");

    let error = fixture
        .score()
        .expect_err("the dataset's score parameters are not JSON");

    assert!(
        matches!(error, ScoringError::InvalidParameters(_)),
        "the JSON parser's refusal must be preserved: {error}"
    );
}

#[test]
fn a_negative_score_precision_is_refused() {
    let mut fixture = Fixture::new("Sum", "10");
    fixture.task.score_precision = -1;

    let error = fixture
        .score()
        .expect_err("a published decimal count cannot be negative");

    assert!(
        matches!(error, ScoringError::NegativePrecision(-1)),
        "the refusal must preserve the task's value: {error}"
    );
}
