//! The Batch task type's evaluation phase: the executable and the input a run is
//! handed, the limits it is held to, and what the run's own answer is worth.
//!
//! The records, the stub language and the stub isolation program every test here
//! is decided by live beside this file, so a test is a claim about the task type
//! and nothing else: which files a run is handed, which flags it is held to, what
//! a run that answered nothing is told, and what the reference refuses before
//! anything is launched.

#[path = "tasktypes_helpers.rs"]
mod helpers;

use cms_proto::DigestMap;
use cms_worker::job::EvaluationJob;
use cms_worker::tasktypes::{Batch, TaskError};
use serde_json::json;

use helpers::{
    answered, content_of, digests, evaluate_job, flags_of, runtime_of, staged, store_of, workspace,
    StubToolchain, CLEAN_LOG, EXECUTABLE, INPUT_DIGEST, NOTHING, PROGRAM_DIGEST, STOPPED_LOG,
};

/// The parameters of a task that stands by itself and redirects both its streams,
/// which is the one every evaluation below is run with.
fn alone() -> Batch {
    Batch::new(&json!(["alone", ["", ""], "diff"])).expect("three parameters are a task")
}

/// The one executable a Batch result is expected to hold, which is what every job
/// below but the refusal of two is built around.
fn one_executable() -> DigestMap {
    digests(&[(EXECUTABLE, PROGRAM_DIGEST)])
}

/// The flags a run was held to, each of which the box must have been given.
fn held_to(flags: &str, expected: &[&str]) {
    for flag in expected {
        assert!(flags.contains(flag), "{flag} must be among {flags}");
    }
}

#[test]
fn an_evaluation_runs_the_executable_under_the_datasets_limits_and_hands_on_its_answer() {
    let dir = workspace("evaluate");
    let runtime = runtime_of(&dir, "0", CLEAN_LOG, &answered());
    let evaluated = alone()
        .evaluate(
            &evaluate_job(one_executable()),
            &StubToolchain,
            &runtime,
            Box::new(store_of(&dir)),
        )
        .expect("the evaluation must run");

    assert!(evaluated.success && evaluated.ran);
    assert_eq!(
        evaluated.outcome, None,
        "an answer not yet judged has no score"
    );
    let answer = evaluated.output_file.as_ref().expect("the file to compare");
    assert!(answer.path.ends_with("output.txt"));
    assert_eq!(answer.filename, "");
    let box_of = &evaluated.sandboxes[0];
    assert_eq!(
        staged(box_of),
        vec!["flags.txt", "input.txt", "output.txt", "sol"]
    );
    held_to(
        &flags_of(box_of),
        &[
            "--stdin=/tmp/input.txt",
            "--stdout=/tmp/output.txt",
            "--time=5",
            "--wall-time=11",
            "--cg-mem=1024",
            "--processes=1000",
        ],
    );
}

#[test]
fn a_job_asking_for_the_answer_gets_it_stored_and_one_only_to_run_stops_early() {
    let dir = workspace("evaluate-output");
    let store = store_of(&dir);
    let runtime = runtime_of(&dir, "0", CLEAN_LOG, &answered());
    let batch = alone();

    let mut fetching = evaluate_job(one_executable());
    fetching.get_output = Some(true);
    let fetched = batch
        .evaluate(&fetching, &StubToolchain, &runtime, Box::new(store.clone()))
        .expect("the evaluation must run");
    let digest = fetched
        .user_output
        .as_ref()
        .expect("the answer was asked for");
    assert_eq!(content_of(&store, digest.as_str()), b"the answer");
    assert!(
        fetched.output_file.is_some(),
        "and it is still there to compare"
    );

    let only = workspace("evaluate-execution");
    let running = runtime_of(&only, "0", CLEAN_LOG, &answered());
    let mut just_running = evaluate_job(one_executable());
    just_running.only_execution = Some(true);
    let executed = batch
        .evaluate(
            &just_running,
            &StubToolchain,
            &running,
            Box::new(store_of(&only)),
        )
        .expect("the evaluation must run");
    assert_eq!(executed.outcome, Some(0.0));
    assert_eq!(executed.text, vec!["Execution completed successfully"]);
    assert!(executed.output_file.is_none());
}

#[test]
fn a_run_that_wrote_nothing_and_a_run_that_was_stopped_are_both_charged_nothing() {
    let silent = workspace("evaluate-nothing");
    let runtime = runtime_of(&silent, "0", CLEAN_LOG, NOTHING);
    let mut asking = evaluate_job(one_executable());
    asking.get_output = Some(true);
    let wrote_nothing = alone()
        .evaluate(
            &asking,
            &StubToolchain,
            &runtime,
            Box::new(store_of(&silent)),
        )
        .expect("the evaluation must run");
    assert!(wrote_nothing.success && wrote_nothing.ran);
    assert_eq!(wrote_nothing.outcome, Some(0.0));
    assert_eq!(
        wrote_nothing.text,
        vec!["Evaluation didn't produce file", "output.txt"]
    );
    assert!(wrote_nothing.user_output.is_none());

    let stopped_dir = workspace("evaluate-stopped");
    let stopping = runtime_of(&stopped_dir, "1", STOPPED_LOG, &answered());
    let stopped = alone()
        .evaluate(
            &evaluate_job(one_executable()),
            &StubToolchain,
            &stopping,
            Box::new(store_of(&stopped_dir)),
        )
        .expect("the evaluation must run");
    assert!(stopped.success, "the box worked");
    assert!(
        !stopped.ran,
        "the run itself did not do what it was asked to"
    );
    assert_eq!(stopped.outcome, Some(0.0));
    assert_eq!(stopped.text, vec!["Execution timed out"]);
    assert!(stopped.output_file.is_none());
}

#[test]
fn the_three_refusals_are_made_before_a_run_is_launched() {
    let batch = alone();
    let toolchain = StubToolchain;
    let refused = |job: &EvaluationJob, label: &str| {
        let dir = workspace(label);
        let runtime = runtime_of(&dir, "0", CLEAN_LOG, &answered());
        let store = store_of(&dir);
        batch.evaluate(job, &toolchain, &runtime, Box::new(store))
    };

    let two = evaluate_job(digests(&[
        (EXECUTABLE, PROGRAM_DIGEST),
        ("other", INPUT_DIGEST),
    ]));
    let counted = refused(&two, "refuse-count");
    assert!(
        matches!(
            counted,
            Err(TaskError::UnexpectedExecutables {
                found: 2,
                wanted: 1
            })
        ),
        "a result of two executables cannot be evaluated"
    );

    let mut no_time = evaluate_job(one_executable());
    no_time.time_limit = Some(0.0);
    let timed = refused(&no_time, "refuse-time");
    assert!(
        matches!(timed, Err(TaskError::NonPositiveLimit { limit: "time limit", value }) if value == 0.0),
        "a time limit of zero bounds nothing"
    );

    let mut no_memory = evaluate_job(one_executable());
    no_memory.memory_limit = Some(-1);
    let bounded = refused(&no_memory, "refuse-memory");
    assert!(
        matches!(
            bounded,
            Err(TaskError::NonPositiveLimit {
                limit: "memory limit",
                ..
            })
        ),
        "a memory limit below zero bounds nothing"
    );
}
