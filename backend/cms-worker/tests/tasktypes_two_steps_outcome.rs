//! What a Two Steps evaluation left behind is worth, and the refusals made before
//! anything is launched.
//!
//! These are the same claims the phase itself is judged by, read from the other end:
//! a run that was stopped and a run that wrote no answer are both worth nothing, and
//! a result holding the wrong number of executables or a limit bounding nothing is
//! refused with nothing launched and nothing left behind.

#[path = "tasktypes_two_steps_helpers.rs"]
mod support;

use cms_worker::job::EvaluationJob;
use cms_worker::stage::FsCache;
use cms_worker::tasktypes::{TaskError, TwoSteps};
use serde_json::json;

use support::{
    digests, job, runtime_of, store_of, workspace, StubToolchain, CLEAN_LOG, NO_CREDIT,
    PROGRAM_DIGEST, STOPPED_LOG,
};

/// A task whose answer is compared with a white diff, the one every evaluation below
/// is run with.
fn task() -> TwoSteps {
    TwoSteps::new(&json!(["diff"])).expect("one parameter is a task")
}

#[test]
fn a_stopped_phase_and_a_phase_that_wrote_nothing_are_both_charged_nothing() {
    let stopped = workspace("two-steps-stopped");
    let runtime = runtime_of(&stopped, STOPPED_LOG, true);
    let timed = task()
        .evaluate(
            &job(),
            &StubToolchain,
            &runtime,
            Box::new(store_of(&stopped)),
        )
        .expect("the evaluation must run");
    assert!(timed.success, "the box worked");
    assert!(!timed.ran, "a phase stopped by its limit did not answer");
    assert_eq!(timed.outcome, Some(NO_CREDIT));
    assert_eq!(timed.text, vec!["Execution timed out"]);

    let silent = workspace("two-steps-nothing");
    let runtime = runtime_of(&silent, CLEAN_LOG, false);
    let wrote_nothing = task()
        .evaluate(
            &job(),
            &StubToolchain,
            &runtime,
            Box::new(store_of(&silent)),
        )
        .expect("the evaluation must run");
    assert!(wrote_nothing.success && wrote_nothing.ran);
    assert_eq!(wrote_nothing.outcome, Some(NO_CREDIT));
    assert_eq!(
        wrote_nothing.text,
        vec!["Evaluation didn't produce file", "output.txt"]
    );
    assert!(wrote_nothing.output_file.is_none());
}

#[test]
fn the_refusals_are_made_before_a_run_is_launched() {
    let refused = |job: EvaluationJob, label: &str| {
        let dir = workspace(label);
        let runtime = runtime_of(&dir, CLEAN_LOG, false);
        let store: FsCache = store_of(&dir);
        task().evaluate(&job, &StubToolchain, &runtime, Box::new(store))
    };

    let mut two = job();
    two.executables
        .extend(digests(&[("other", PROGRAM_DIGEST)]));
    assert!(matches!(
        refused(two, "two-steps-count"),
        Err(TaskError::UnexpectedExecutables {
            found: 2,
            wanted: 1
        })
    ));

    let mut no_time = job();
    no_time.time_limit = Some(0.0);
    assert!(matches!(
        refused(no_time, "two-steps-time"),
        Err(TaskError::NonPositiveLimit { limit: "time limit", value }) if value == 0.0
    ));

    let mut no_memory = job();
    no_memory.memory_limit = Some(-1);
    assert!(matches!(
        refused(no_memory, "two-steps-memory"),
        Err(TaskError::NonPositiveLimit {
            limit: "memory limit",
            ..
        })
    ));
}
