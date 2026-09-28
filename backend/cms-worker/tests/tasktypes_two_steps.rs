//! The Two Steps task type: one program run twice, the first computing something the
//! second has to recover, the two talking through one named pipe.
//!
//! The records, the stub language and the stub isolation program every test here is
//! decided by live beside this file, so a test is a claim about the task type and
//! nothing else: that both phases are started before either is waited for, that what
//! the two were charged is merged as one run's, and which stream each phase is given.

#[path = "tasktypes_two_steps_helpers.rs"]
mod support;

use cms_worker::tasktypes::TwoSteps;
use serde_json::json;

use support::{
    content_of, flags_of, job, order_of, runtime_of, store_of, workspace, StubToolchain, CLEAN_LOG,
    NO_CREDIT, TWO,
};

/// A task whose answer is compared with a white diff, the one every evaluation below
/// is run with.
fn task() -> TwoSteps {
    TwoSteps::new(&json!(["diff"])).expect("one parameter is a task")
}

#[test]
fn both_phases_are_started_before_either_is_waited_for() {
    let dir = workspace("two-steps-starts");
    let runtime = runtime_of(&dir, CLEAN_LOG, true);
    let evaluated = task()
        .evaluate(&job(), &StubToolchain, &runtime, Box::new(store_of(&dir)))
        .expect("the evaluation must run");

    assert!(evaluated.success && evaluated.ran);
    assert_eq!(evaluated.sandboxes.len(), 2, "one box per phase");
    let order = order_of(&dir);
    let started = order
        .iter()
        .filter(|line| line.starts_with("start "))
        .count();
    assert_eq!(started, TWO, "both runs are started: {order:?}");
    assert_eq!(
        order.iter().position(|line| line.starts_with("end ")),
        Some(TWO),
        "both are started before the first is waited for, or a phase writing down the pipe would wait for a reader that had not been started: {order:?}"
    );
}

#[test]
fn the_two_charges_are_merged_as_one_and_the_first_reads_the_input() {
    let dir = workspace("two-steps-merge");
    let runtime = runtime_of(&dir, CLEAN_LOG, true);
    let evaluated = task()
        .evaluate(&job(), &StubToolchain, &runtime, Box::new(store_of(&dir)))
        .expect("the evaluation must run");

    let charged = evaluated.stats.as_ref().expect("both phases were charged");
    assert_eq!(
        charged.cpu_time,
        Some(1.0),
        "two phases alive at once add up"
    );
    assert_eq!(
        charged.wall_time,
        Some(1.5),
        "the clock of two alive at once is the wider, not the sum"
    );
    let first = flags_of(&evaluated.sandboxes[0]);
    assert!(first.contains("--stdin=/tmp/input.txt"), "{first}");
    assert!(first.contains("/fifo=") && first.contains(":rw"), "{first}");
    let second = flags_of(&evaluated.sandboxes[1]);
    assert!(second.contains("--stdout=/tmp/output.txt"), "{second}");
    for flags in [&first, &second] {
        for flag in [
            "--time=5",
            "--wall-time=11",
            "--fsize=2048",
            "--cg-mem=1024",
        ] {
            assert!(flags.contains(flag), "{flag} must be among {flags}");
        }
    }
}

#[test]
fn the_answer_is_handed_on_for_comparison_and_stored_when_asked_for() {
    let dir = workspace("two-steps-answer");
    let store = store_of(&dir);
    let runtime = runtime_of(&dir, CLEAN_LOG, true);
    let judged = task()
        .evaluate(&job(), &StubToolchain, &runtime, Box::new(store.clone()))
        .expect("the evaluation must run");
    assert_eq!(judged.outcome, None, "an unjudged answer has no score");
    let answer = judged.output_file.as_ref().expect("the file to compare");
    assert!(answer.path.ends_with("output.txt"), "{:?}", answer.path);

    let fetching = workspace("two-steps-fetch");
    let store = store_of(&fetching);
    let runtime = runtime_of(&fetching, CLEAN_LOG, true);
    let mut asking = job();
    asking.get_output = Some(true);
    let fetched = task()
        .evaluate(&asking, &StubToolchain, &runtime, Box::new(store.clone()))
        .expect("the evaluation must run");
    let digest = fetched
        .user_output
        .as_ref()
        .expect("the answer was asked for");
    assert_eq!(content_of(&store, digest.as_str()), b"the answer");
}

#[test]
fn a_job_only_asked_to_be_run_is_answered_before_the_answer_is_compared() {
    let dir = workspace("two-steps-execution");
    let runtime = runtime_of(&dir, CLEAN_LOG, true);
    let mut just_running = job();
    just_running.only_execution = Some(true);
    let executed = task()
        .evaluate(
            &just_running,
            &StubToolchain,
            &runtime,
            Box::new(store_of(&dir)),
        )
        .expect("the evaluation must run");
    assert_eq!(executed.outcome, Some(NO_CREDIT));
    assert_eq!(executed.text, vec!["Execution completed successfully"]);
    assert!(
        executed.output_file.is_none(),
        "a job that only asked to be run hands nothing to a comparison"
    );
}

#[test]
fn the_one_parameter_is_read_as_a_choice() {
    let diff = TwoSteps::new(&json!(["diff"])).expect("one string is a task");
    assert!(!diff.uses_comparator());
    let checker = TwoSteps::new(&json!(["comparator"])).expect("one string is a task");
    assert!(checker.uses_comparator());
    assert!(
        TwoSteps::new(&json!([])).is_err(),
        "no parameter is not a task"
    );
    assert!(TwoSteps::new(&json!(["diff", "extra"])).is_err());
}
