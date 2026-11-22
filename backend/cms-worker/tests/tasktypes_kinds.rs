//! The `OutputOnly` task type: the one parameter it is configured with, the
//! compilation it does not make, and the answer a testcase is judged on.
//!
//! The records, the stub language and the stub isolation program every test here is
//! decided by live beside this file, so a test is a claim about the task type and
//! nothing else: which parameter says how an answer is compared, that nothing is
//! compiled, and that a testcase is judged on the file the submission carried under
//! that testcase's own name.

#[path = "tasktypes_kinds_helpers.rs"]
mod support;

use cms_worker::tasktypes::{OutputOnly, TaskError};
use serde_json::json;

use support::toolchain::{
    runtime_of, store_of, workspace, CLEAN_LOG, GRADER_DIGEST, NOTHING, SOURCE_DIGEST,
};
use support::{evaluation, output_only, ANSWER, ANSWER_DIGEST, OTHER_ANSWER, TESTCASE};

#[test]
fn an_output_only_task_is_configured_by_the_one_choice_it_compares_answers_by() {
    let checker = OutputOnly::new(&json!(["comparator"])).expect("one parameter is a task");
    let diff = OutputOnly::new(&json!(["diff"])).expect("one parameter is a task");
    assert!(checker.uses_comparator() && !diff.uses_comparator());
    for wrong in [
        json!([]),
        json!(["diff", "diff"]),
        json!([1]),
        json!("diff"),
    ] {
        assert!(
            matches!(OutputOnly::new(&wrong), Err(TaskError::Parameters)),
            "{wrong} is not one parameter"
        );
    }
}

#[test]
fn an_output_only_submission_is_compiled_without_a_box() {
    let compiled = output_only().compile();
    assert!(compiled.success);
    assert_eq!(compiled.compilation_success, Some(true));
    assert_eq!(compiled.text, vec!["No compilation needed"]);
    assert!(
        compiled.sandboxes.is_empty() && compiled.executables.is_empty(),
        "there is no source to compile, so no box is made and none is kept"
    );
    assert!(compiled.stats.is_none() && compiled.diagnostics.is_empty());
}

#[test]
fn a_carried_answer_is_diffed_with_the_answer_the_dataset_says_is_right() {
    let dir = workspace("kinds-diff");
    let runtime = runtime_of(&dir, "0", CLEAN_LOG, NOTHING);
    let store = store_of(&dir);
    let task = OutputOnly::new(&json!(["diff"])).expect("one parameter is a task");

    for (answer, outcome, text) in [
        (SOURCE_DIGEST, 1.0, "Output is correct"),
        (GRADER_DIGEST, 0.0, "Output isn't correct"),
    ] {
        let judged = task
            .evaluate(
                &evaluation(TESTCASE, &[(ANSWER, answer)], &[]),
                &runtime,
                Box::new(store.clone()),
            )
            .expect("a carried answer is judged");

        assert!(judged.success);
        assert_eq!(judged.outcome, Some(outcome), "the answer {answer}");
        assert_eq!(judged.text, vec![text]);
        assert_eq!(
            judged.output.as_ref().map(|digest| digest.as_str()),
            Some(answer),
            "the answer that was judged is still named"
        );
    }
}

#[test]
fn a_checker_the_dataset_does_not_hold_is_a_check_that_could_not_be_made() {
    let dir = workspace("kinds-checker");
    let runtime = runtime_of(&dir, "0", CLEAN_LOG, NOTHING);

    let judged = output_only()
        .evaluate(
            &evaluation(TESTCASE, &[(ANSWER, SOURCE_DIGEST)], &[]),
            &runtime,
            Box::new(store_of(&dir)),
        )
        .expect("a carried answer is decided");

    assert!(
        !judged.success,
        "a checker that is not in the dataset is not a wrong answer"
    );
    assert_eq!(
        judged.outcome, None,
        "nothing was decided about the answer, so it earns no zero either"
    );
    assert!(
        judged.text.is_empty(),
        "and there is nothing to show for it"
    );
}

#[test]
fn a_testcase_nobody_answered_is_scored_nothing_and_says_so() {
    let dir = workspace("kinds-uncarried");
    let runtime = runtime_of(&dir, "0", CLEAN_LOG, NOTHING);

    let judged = OutputOnly::new(&json!(["diff"]))
        .expect("one parameter is a task")
        .evaluate(
            &evaluation(TESTCASE, &[(OTHER_ANSWER, ANSWER_DIGEST)], &[]),
            &runtime,
            Box::new(store_of(&dir)),
        )
        .expect("the evaluation must be decided");

    assert!(judged.success);
    assert_eq!(
        judged.outcome,
        Some(0.0),
        "an answer for another testcase is not this one's answer"
    );
    assert_eq!(judged.text, vec!["File not submitted"]);
    assert!(judged.output.is_none());
}
