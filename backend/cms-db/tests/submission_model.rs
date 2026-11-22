//! The result's state machine walked as sequences: every step names the status before and after.

use cms_db::{
    max_resources, DatasetId, Evaluation, Submission, SubmissionId, SubmissionRecord,
    SubmissionResult, SubmissionStatus, EVALUATION, SUBMISSION,
};

/// A result key that stands for nothing: every id here is a fixture.
const SUBMISSION_ID: SubmissionId = SubmissionId(41);
const DATASET_ID: DatasetId = DatasetId(9);

/// A result nothing has been written to.
fn fresh() -> SubmissionResult {
    SubmissionResult::new(SUBMISSION_ID, DATASET_ID)
}

/// The same result with all five score fields written.
fn scored(mut result: SubmissionResult) -> SubmissionResult {
    result.score = Some(100.0);
    result.score_details = Some("[{\"score\": 100.0}]".to_string());
    result.public_score = Some(100.0);
    result.public_score_details = Some("[{\"score\": 100.0}]".to_string());
    result.ranking_score_details = Some(vec!["100.0".to_string()]);
    result
}

/// A testcase run that used `time` seconds and `memory` bytes, either of which may be absent.
fn evaluation(testcase_id: i32, time: Option<f64>, memory: Option<i64>) -> Evaluation {
    Evaluation {
        id: testcase_id,
        submission_id: SUBMISSION_ID.0,
        dataset_id: DATASET_ID.0,
        testcase_id,
        outcome: Some("1.0".to_string()),
        text: Vec::new(),
        admin_text: None,
        execution_time: time,
        execution_wall_clock_time: None,
        execution_memory: memory,
        evaluation_shard: None,
        evaluation_sandbox_paths: None,
        evaluation_sandbox_digests: None,
    }
}

/// A submission carrying a comment of several lines.
fn commented(comment: &str) -> Submission {
    Submission {
        record: SubmissionRecord {
            id: SUBMISSION_ID,
            task_id: 7,
            participation_id: 12,
            timestamp: chrono::DateTime::from_timestamp(0, 0)
                .expect("the epoch is in range")
                .naive_utc(),
            language: Some("rust".to_string()),
            official: true,
        },
        opaque_id: 1,
        comment: comment.to_string(),
    }
}

#[test]
fn the_declarations_describe_both_tables_and_their_keys() {
    SUBMISSION
        .validate()
        .expect("the declaration must describe a table");
    EVALUATION
        .validate()
        .expect("the declaration must describe a table");

    assert_eq!(SUBMISSION.table, "submissions");
    let carried: Vec<&str> = SUBMISSION
        .value_columns()
        .map(|column| column.name)
        .collect();
    // Identity and the two foreign keys are not values an attribute set carries.
    assert_eq!(
        carried,
        ["opaque_id", "timestamp", "language", "comment", "official"]
    );
    assert_eq!(EVALUATION.table, "evaluations");
    assert!(EVALUATION
        .columns
        .iter()
        .any(|column| column.name == "testcase_id" && column.foreign_key));
}

#[test]
fn a_result_nothing_was_written_to_is_compiling() {
    let result = fresh();

    assert_eq!(result.status(), SubmissionStatus::Compiling);
    assert!(!result.compiled() && !result.evaluated() && !result.scored());
    assert!(!result.needs_scoring());
}

#[test]
fn a_compilation_walks_from_compiling_to_evaluating() {
    let mut result = fresh();
    result.set_compilation_outcome(true);

    assert_eq!(result.status(), SubmissionStatus::Evaluating);
    assert!(result.compilation_succeeded());
    assert!(
        !result.needs_scoring(),
        "a compiled result waits for evaluation"
    );
}

#[test]
fn a_rejected_submission_owes_a_score_without_ever_evaluating() {
    let mut result = fresh();
    result.set_compilation_outcome(false);

    assert_eq!(result.status(), SubmissionStatus::CompilationFailed);
    assert!(result.needs_scoring());
}

#[test]
fn evaluation_moves_to_scoring_and_a_full_score_to_scored() {
    let mut result = fresh();
    result.set_compilation_outcome(true);
    result.set_evaluation_outcome();
    assert_eq!(result.status(), SubmissionStatus::Scoring);
    assert!(result.needs_scoring());

    let result = scored(result);
    assert_eq!(result.status(), SubmissionStatus::Scored);
    assert!(!result.needs_scoring());
}

#[test]
fn a_partial_score_is_not_a_score() {
    let mut result = scored(fresh());
    result.set_compilation_outcome(true);
    result.set_evaluation_outcome();
    result.ranking_score_details = None;

    assert_eq!(
        result.status(),
        SubmissionStatus::Scoring,
        "the reference requires all five score fields"
    );
    assert!(result.needs_scoring());
}

#[test]
fn a_rejection_is_reported_before_a_score_even_when_both_are_present() {
    let mut result = scored(fresh());
    result.set_compilation_outcome(false);

    assert_eq!(
        result.status(),
        SubmissionStatus::CompilationFailed,
        "`get_status` asks about compilation before it asks about the score"
    );
}

#[test]
fn clearing_one_testcases_evaluation_still_clears_the_whole_outcome() {
    let mut result = scored(fresh());
    result.set_compilation_outcome(true);
    result.set_evaluation_outcome();

    result.clear_evaluation();

    assert_eq!(result.status(), SubmissionStatus::Evaluating);
    assert!(result.evaluation_outcome.is_none());
    assert!(result.score.is_none() && result.public_score.is_none());
    assert_eq!(
        result.compilation_outcome.map(|outcome| outcome.as_str()),
        Some("ok")
    );
}

#[test]
fn invalidating_the_compilation_clears_everything_below_it() {
    let mut result = scored(fresh());
    result.set_compilation_outcome(true);
    result.set_evaluation_outcome();
    result.compilation_tries = 2;
    result.evaluation_tries = 1;

    result.clear_compilation();

    assert_eq!(result.status(), SubmissionStatus::Compiling);
    assert!(result.compilation_outcome.is_none() && result.evaluation_outcome.is_none());
    assert_eq!((result.compilation_tries, result.evaluation_tries), (0, 0));
    assert!(!result.scored());
}

#[test]
fn invalidating_only_the_score_leaves_the_outcomes_alone() {
    let mut result = scored(fresh());
    result.set_compilation_outcome(true);
    result.set_evaluation_outcome();

    result.clear_score();

    assert_eq!(result.status(), SubmissionStatus::Scoring);
    assert!(result.evaluation_outcome.is_some());
    assert!(result.compilation_succeeded());
}

#[test]
fn the_reported_resources_are_the_largest_of_the_runs_that_measured_one() {
    let runs = [
        evaluation(1, Some(0.5), Some(1_024)),
        evaluation(2, Some(2.0), None),
        evaluation(3, None, Some(4_096)),
    ];

    assert_eq!(max_resources(&runs), (Some(2.0), Some(4_096)));
}

#[test]
fn a_run_that_measured_nothing_reports_nothing() {
    let runs = [evaluation(1, None, None)];

    assert_eq!(max_resources(&runs), (None, None));
    assert_eq!(max_resources(&[]), (None, None));
}

#[test]
fn the_short_comment_is_the_first_line_of_the_comment() {
    assert_eq!(commented("first\nsecond").short_comment(), "first");
    assert_eq!(commented("").short_comment(), "");
    assert_eq!(commented("only").short_comment(), "only");
}
