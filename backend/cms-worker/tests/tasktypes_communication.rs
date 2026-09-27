//! The Communication task type: a manager, the submission beside it, and the
//! named pipes they talk through.
//!
//! The records, the stub language and the stub isolation program every test here
//! is decided by live beside this file, so a test is a claim about the task type and
//! nothing else: that every run is started before any of them is waited for, that
//! the processes' charges are merged as one and the total read against the limit,
//! that the manager's own two streams are where the score and the words come from,
//! and what the reference refuses before a pipe is even made.

#[path = "tasktypes_communication_helpers.rs"]
mod support;

use cms_worker::tasktypes::{Communication, TaskError};
use cms_worker::ExitStatus;
use serde_json::json;

use support::{
    content_of, dataset, digests, flags_of, job, order_of, runtime_of, store_of, words_of,
    workspace, StubToolchain, EXECUTABLE, INPUT_DIGEST, MANAGER, PROGRAM_DIGEST, THREE,
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

#[test]
fn a_process_is_told_where_its_pipes_are_and_otherwise_has_them_as_its_streams() {
    let named = workspace("communication-fifos");
    let runtime = runtime_of(&named, "0.5", THREE);
    let fifos = two()
        .evaluate(&job(), &StubToolchain, &runtime, Box::new(store_of(&named)))
        .expect("the evaluation must run");
    assert_eq!(fifos.outcome, Some(42.5));
    let first = words_of(&fifos.sandboxes[1]);
    assert!(
        first.ends_with(&[
            "/fifo0/m_to_u0".to_owned(),
            "/fifo0/u0_to_m".to_owned(),
            "0".to_owned()
        ]),
        "a process is told both of its pipes and its own index: {first:?}"
    );
    let second = words_of(&fifos.sandboxes[2]);
    assert!(
        second.ends_with(&[
            "/fifo1/m_to_u1".to_owned(),
            "/fifo1/u1_to_m".to_owned(),
            "1".to_owned()
        ]),
        "the second is told the second pair and its own index, not the first one's: {second:?}"
    );
    let manager = words_of(&fifos.sandboxes[0]);
    assert!(
        manager
            .windows(2)
            .any(|pair| pair == ["/fifo0/u0_to_m", "/fifo0/m_to_u0"])
            && manager.contains(&"/fifo1/u1_to_m".to_owned()),
        "the manager is given both ends of every pair, one process after another: {manager:?}"
    );

    let streams = workspace("communication-std");
    let runtime = runtime_of(&streams, "0.5", THREE);
    let evaluated = Communication::new(&json!([2, "stub", "std_io"]))
        .expect("a task")
        .evaluate(
            &job(),
            &StubToolchain,
            &runtime,
            Box::new(store_of(&streams)),
        )
        .expect("the evaluation must run");
    let process = flags_of(&evaluated.sandboxes[1]);
    assert!(
        process.contains("--stdin=/fifo0/m_to_u0"),
        "the pipe is the process's own standard input: {process}"
    );
    assert!(
        process.contains("--stdout=/fifo0/u0_to_m"),
        "and the other one is its standard output: {process}"
    );
    assert!(
        !words_of(&evaluated.sandboxes[1])
            .iter()
            .any(|word| word.starts_with("/fifo")),
        "and no pipe is named on the command line, the streams carry them instead"
    );
}

#[test]
fn the_refusals_are_made_before_a_pipe_is_made() {
    let mut two_executables = digests(&[(EXECUTABLE, PROGRAM_DIGEST)]);
    two_executables.insert("other".to_owned(), INPUT_DIGEST.to_owned());
    let dir = workspace("refuse-count");
    let runtime = runtime_of(&dir, "0.5", THREE);
    let mut counted = job();
    counted.executables = two_executables;
    assert!(
        matches!(
            two().evaluate(&counted, &StubToolchain, &runtime, Box::new(store_of(&dir))),
            Err(TaskError::UnexpectedExecutables {
                found: 2,
                wanted: 1
            })
        ),
        "a result of two executables cannot be run as a Communication task"
    );

    let dir = workspace("refuse-manager");
    let runtime = runtime_of(&dir, "0.5", THREE);
    let mut no_manager = job();
    no_manager.managers.remove(MANAGER);
    assert!(
        matches!(
            two().evaluate(&no_manager, &StubToolchain, &runtime, Box::new(store_of(&dir))),
            Err(TaskError::MissingManager { name }) if name == MANAGER
        ),
        "a Communication task runs nothing without its manager"
    );

    let dir = workspace("refuse-time");
    let runtime = runtime_of(&dir, "0.5", THREE);
    let mut no_time = job();
    no_time.time_limit = Some(0.0);
    assert!(
        matches!(
            two().evaluate(&no_time, &StubToolchain, &runtime, Box::new(store_of(&dir))),
            Err(TaskError::NonPositiveLimit {
                limit: "time limit",
                ..
            })
        ),
        "a time limit of zero bounds nothing"
    );

    let dir = workspace("refuse-memory");
    let runtime = runtime_of(&dir, "0.5", THREE);
    let mut no_memory = job();
    no_memory.memory_limit = Some(-1);
    assert!(
        matches!(
            two().evaluate(
                &no_memory,
                &StubToolchain,
                &runtime,
                Box::new(store_of(&dir))
            ),
            Err(TaskError::NonPositiveLimit {
                limit: "memory limit",
                ..
            })
        ),
        "a memory limit below zero bounds nothing"
    );
}

#[test]
fn the_parameters_are_the_three_a_communication_task_has() {
    for refused in [
        json!(["stub", "std_io"]),
        json!([2, "stub"]),
        json!([0, "stub", "std_io"]),
    ] {
        assert!(
            matches!(Communication::new(&refused), Err(TaskError::Parameters)),
            "a Communication task has three parameters and a positive count: {refused}"
        );
    }
    assert_eq!(two().processes(), 2);
    assert!(
        dataset().managers.contains_key(MANAGER),
        "a Communication task needs its manager among the dataset's managers"
    );
}
