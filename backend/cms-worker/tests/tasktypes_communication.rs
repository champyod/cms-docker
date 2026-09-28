//! The Communication task type: a manager, the submission beside it, and the
//! named pipes they talk through.
//!
//! The records, the stub language and the stub isolation program every test here
//! is decided by live beside this file, so a test is a claim about the task type and
//! nothing else: that every run is started before any of them is waited for, the
//! clock the manager is given over a process, that the processes' charges are merged
//! as one and the total read against the limit, and that the manager's own two
//! streams are where the score and the words come from.

#[path = "tasktypes_communication_helpers.rs"]
mod support;

use cms_worker::tasktypes::Communication;
use cms_worker::ExitStatus;
use serde_json::json;

use support::{
    content_of, flags_of, job, order_of, runtime_of, store_of, workspace, StubToolchain, THREE,
};

/// A task with two processes, the stub, and the pipes handed to each process as
/// arguments, which is the one every evaluation below is run with.
fn two() -> Communication {
    Communication::new(&json!([2, "stub", "fifo_io"])).expect("three parameters are a task")
}

#[test]
fn every_run_is_started_before_any_of_them_is_waited_for() {
    let dir = workspace("communication-starts");
    let runtime = runtime_of(&dir, "0.5", THREE);
    let evaluated = two()
        .evaluate(&job(), &StubToolchain, &runtime, Box::new(store_of(&dir)))
        .expect("the evaluation must run");

    assert!(evaluated.success && evaluated.ran);
    assert_eq!(evaluated.outcome, Some(42.5));
    assert_eq!(evaluated.text, vec!["wrong answer"]);
    assert_eq!(
        evaluated.admin_text.as_deref(),
        Some("read the input twice")
    );
    assert_eq!(
        evaluated.sandboxes.len(),
        3,
        "one box for the manager and one per process"
    );

    let order = order_of(&dir);
    let started: Vec<&String> = order
        .iter()
        .filter(|line| line.starts_with("start "))
        .collect();
    assert_eq!(started.len(), THREE, "every run is started: {order:?}");
    assert_eq!(
        order.iter().position(|line| line.starts_with("end ")),
        Some(THREE),
        "all three are started before the first is waited for, or a manager and a process that must talk cannot both make progress: {order:?}"
    );
}

#[test]
fn the_manager_is_given_the_sum_of_what_every_process_is_each_given() {
    let dir = workspace("communication-clock");
    let runtime = runtime_of(&dir, "0.5", THREE);
    let evaluated = two()
        .evaluate(&job(), &StubToolchain, &runtime, Box::new(store_of(&dir)))
        .expect("the evaluation must run");

    let manager = flags_of(&evaluated.sandboxes[0]);
    assert!(
        manager.contains("--time=12") && manager.contains("--wall-time=25"),
        "two processes at a five second limit are what the manager is held to, the grace counted on each: {manager}"
    );
    let process = flags_of(&evaluated.sandboxes[1]);
    assert!(
        process.contains("--time=5") && process.contains("--wall-time=11"),
        "a process is held to the dataset's own limit, not to the manager's wider one: {process}"
    );
}

#[test]
fn the_processes_charges_are_merged_as_one_and_the_total_read_against_the_limit() {
    let dir = workspace("communication-merge");
    let runtime = runtime_of(&dir, "3.0", THREE);
    let evaluated = two()
        .evaluate(&job(), &StubToolchain, &runtime, Box::new(store_of(&dir)))
        .expect("the evaluation must run");

    let charged = evaluated
        .stats
        .as_ref()
        .expect("the processes were charged");
    assert_eq!(
        charged.cpu_time,
        Some(6.0),
        "two processes alive at once add up"
    );
    assert_eq!(
        charged.exit_status,
        ExitStatus::Timeout,
        "a total of six seconds against a limit of five is a timeout, and no single box can see that total"
    );
    assert!(
        evaluated.success,
        "a process stopped by the total is not a box that failed"
    );
    assert_eq!(evaluated.outcome, Some(0.0));
    assert_eq!(evaluated.text, vec!["Execution timed out"]);
}

#[test]
fn a_total_under_the_limit_is_the_manager_to_answer_for() {
    let dir = workspace("communication-total");
    let runtime = runtime_of(&dir, "0.5", THREE);
    let evaluated = two()
        .evaluate(&job(), &StubToolchain, &runtime, Box::new(store_of(&dir)))
        .expect("the evaluation must run");
    assert_eq!(evaluated.outcome, Some(42.5));
    assert_eq!(
        evaluated.stats.as_ref().and_then(|stats| stats.cpu_time),
        Some(1.0),
        "a total under the limit is not reclassified"
    );
}

#[test]
fn a_job_asking_for_the_managers_note_gets_it_stored() {
    let dir = workspace("communication-output");
    let store = store_of(&dir);
    let runtime = runtime_of(&dir, "0.5", THREE);
    let mut asking = job();
    asking.get_output = Some(true);
    let evaluated = two()
        .evaluate(&asking, &StubToolchain, &runtime, Box::new(store.clone()))
        .expect("the evaluation must run");
    let digest = evaluated
        .user_output
        .as_ref()
        .expect("the note was asked for and the manager wrote one");
    assert_eq!(
        content_of(&store, digest.as_str()),
        b"the note",
        "the file a manager writes is stored under the digest the report names it by"
    );
}

#[test]
fn a_job_only_asked_to_be_run_is_answered_before_the_manager_is_read() {
    let dir = workspace("communication-execution");
    let runtime = runtime_of(&dir, "9.0", THREE);
    let mut just_running = job();
    just_running.only_execution = Some(true);
    let evaluated = two()
        .evaluate(
            &just_running,
            &StubToolchain,
            &runtime,
            Box::new(store_of(&dir)),
        )
        .expect("the evaluation must run");
    assert_eq!(evaluated.outcome, Some(0.0));
    assert_eq!(evaluated.text, vec!["Execution completed successfully"]);
    assert!(evaluated.admin_text.is_none());
    assert!(
        evaluated.ran,
        "a job that only asked to be run is answered before the processes' failure is looked for"
    );
}
