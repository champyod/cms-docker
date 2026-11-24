//! The judge over an answer a checker reads: the checker the dataset names, the checker
//! it does not hold, and the checker that answered nothing readable.
//!
//! The distinction this file exists for is that a check which could not be made is not a
//! wrong answer: the first is a fault of the dataset or the worker and decides nothing
//! about the submission, and the second is worth zero. A judge that collapsed them would
//! fail an honest contestant for a configuration mistake.

#[path = "judge_helpers.rs"]
mod judge;

use std::str::FromStr;

use cms_grading::stage::FileDigest;
use cms_grading::tasktypes::{eval_output, OutputSource, TaskError};

use judge::{
    check_box_made, job, judged, staged, workspace, written, ABSENT, ANSWER_FILENAME, CHECKER,
    CLEAN_LOG, SCORED, UNSCORED,
};

#[test]
fn a_checker_the_dataset_does_not_hold_is_a_failure_to_check_and_not_a_wrong_answer() {
    let dir = workspace("judge-no-checker");

    let refused = judged(
        &dir,
        &job(false),
        Some(CHECKER),
        OutputSource::Path(written(&dir, b"the source")),
        SCORED,
    )
    .expect("the dataset is at fault, not the submission");

    assert!(!refused.success, "the checker could not run");
    assert_eq!(
        refused.outcome, None,
        "nothing was decided about the answer, so it is not worth zero either"
    );
    assert!(refused.text.is_empty());
    assert!(
        !check_box_made(&dir),
        "a checker that is not there is refused before a box is made"
    );
}

#[test]
fn a_named_checker_decides_the_answer_in_a_box_of_its_own() {
    let dir = workspace("judge-checker");

    let decided = judged(
        &dir,
        &job(true),
        Some(CHECKER),
        OutputSource::Path(written(&dir, b"the answer")),
        SCORED,
    )
    .expect("the checker must run");

    assert!(decided.success);
    assert_eq!(decided.outcome, Some(0.5), "the checker's own score");
    assert_eq!(decided.text, vec!["Output is partially correct"]);
    assert_eq!(decided.sandboxes.len(), 1, "a box made for the check");
    assert_eq!(
        staged(&decided.sandboxes[0]),
        vec![
            "checker",
            "correct_output.txt",
            "flags.txt",
            "input.txt",
            "user_output.txt",
        ]
    );
}

#[test]
fn a_successful_checker_box_is_kept_only_when_the_worker_asks() {
    for keep in [false, true] {
        let label = if keep {
            "judge-checker-kept"
        } else {
            "judge-checker-removed"
        };
        let dir = workspace(label);
        let runtime = judge::runtime_of(&dir, "0", CLEAN_LOG, SCORED).with_keep_sandbox(keep);
        let decided = eval_output(
            &job(true),
            Some(CHECKER),
            OutputSource::Path(written(&dir, b"the answer")),
            ANSWER_FILENAME,
            &[],
            &runtime,
            judge::store(&dir),
        )
        .expect("the checker must run");

        assert!(decided.success);
        assert_eq!(decided.sandboxes.len(), 1);
        assert_eq!(
            decided.sandboxes[0].is_dir(),
            keep,
            "worker keep_sandbox={keep}"
        );
    }
}

#[test]
fn a_checker_that_printed_no_score_is_a_failure_to_check() {
    let dir = workspace("judge-unscored");

    let undecided = judged(
        &dir,
        &job(true),
        Some(CHECKER),
        OutputSource::Path(written(&dir, b"the source")),
        UNSCORED,
    )
    .expect("the box could carry the run");

    assert!(!undecided.success);
    assert_eq!(undecided.outcome, None);
    assert_eq!(
        undecided.sandboxes.len(),
        1,
        "the box that failed is named, or it cannot be found"
    );
    assert!(
        undecided.sandboxes[0].is_dir(),
        "a checker that returned no verdict keeps its box"
    );
}

#[test]
fn an_answer_the_store_does_not_hold_is_the_workers_own_failure() {
    let dir = workspace("judge-unstored");
    let absent = FileDigest::from_str(ABSENT).expect("a digest the domain admits");

    let refused = judged(
        &dir,
        &job(false),
        None,
        OutputSource::Digest(absent),
        SCORED,
    );

    assert!(
        matches!(refused, Err(TaskError::Stage(_))),
        "a carried answer nothing holds is no answer to diff, not a wrong one: {refused:?}"
    );
}
