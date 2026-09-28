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
fn a_testcase_is_judged_on_the_answer_the_submission_carried_for_it() {
    let judged = output_only()
        .evaluate(&evaluation(TESTCASE, &[(ANSWER, ANSWER_DIGEST)], &[]))
        .expect("the evaluation must be decided");
    assert_eq!(judged.outcome, None, "an unjudged answer has no score yet");
    assert!(judged.text.is_empty());
    let carried = judged.output.expect("the answer that was carried");
    assert_eq!(carried.as_str(), ANSWER_DIGEST);
}

#[test]
fn a_testcase_nobody_answered_is_scored_nothing_and_says_so() {
    let for_another = output_only()
        .evaluate(&evaluation(TESTCASE, &[(OTHER_ANSWER, ANSWER_DIGEST)], &[]))
        .expect("the evaluation must be decided");
    assert_eq!(
        for_another.outcome,
        Some(0.0),
        "an answer for another testcase is not this one's answer"
    );
    assert_eq!(for_another.text, vec!["File not submitted"]);
    assert!(for_another.output.is_none());
}
