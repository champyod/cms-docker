//! The `BatchAndOutput` task type: the testcases its fourth parameter lists, the
//! compilation a submission carrying a source gets, and which of the two kinds of
//! answer a testcase is judged on.
//!
//! The records, the stub language and the stub isolation program every test here is
//! decided by live beside this file, so a test is a claim about the task type and
//! nothing else: which answer wins over a run, which testcase is never run at all,
//! which one runs the executable the way a Batch testcase does, and what the
//! reference refuses before anything is launched.

#[path = "tasktypes_kinds_helpers.rs"]
mod support;

use cms_worker::job::EvaluationJob;
use cms_worker::stage::StageError;
use cms_worker::tasktypes::{BatchAndOutput, Origin, TaskError};
use cms_worker::ExitStatus;
use serde_json::json;

use support::toolchain::{
    answered, content_of, produced, runtime_of, staged, store_of, workspace, StubToolchain,
    CLEAN_LOG, EXECUTABLE, INPUT_DIGEST, NOTHING, PROGRAM_DIGEST, SOURCE, SOURCE_DIGEST,
};
use support::{compilation, evaluation, mixed, ANSWER, ANSWER_DIGEST, TESTCASE, UNADMITTED};

#[test]
fn the_fourth_parameter_names_the_testcases_a_dataset_lists_as_output_only() {
    let task = mixed("1.in,2.in");
    assert!(task.is_output_only(TESTCASE) && task.is_output_only("2.in"));
    assert!(!task.is_output_only("3.in"));
    let batch = task.batch();
    assert!(!batch.uses_grader() && !batch.uses_comparator());
    assert_eq!(batch.actual_input(), "input.txt");
    assert!(batch.redirects_stdout());

    for wrong in [
        json!(["alone", ["", ""], "diff"]),
        json!(["alone", ["", ""], "diff", 4]),
        json!(["alone", [""], "diff", ""]),
    ] {
        assert!(
            matches!(BatchAndOutput::new(&wrong), Err(TaskError::Parameters)),
            "{wrong} is not four parameters the first three of which are a Batch task's"
        );
    }
}

#[test]
fn a_submission_carrying_a_source_is_compiled_the_way_a_batch_one_is() {
    let dir = workspace("mixed-compile");
    let store = store_of(&dir);
    let runtime = runtime_of(&dir, "0", CLEAN_LOG, &produced(EXECUTABLE));
    let compiled = mixed("1.in")
        .compile(
            &compilation(&[(SOURCE, SOURCE_DIGEST)]),
            &StubToolchain,
            &runtime,
            Box::new(store.clone()),
        )
        .expect("the compilation must run");

    assert!(compiled.success);
    assert_eq!(compiled.text, vec!["Compilation succeeded"]);
    assert_eq!(
        compiled.sandboxes.len(),
        1,
        "a source was compiled in a box"
    );
    let program = compiled
        .executables
        .get(EXECUTABLE)
        .expect("the executable");
    assert_eq!(content_of(&store, program), b"the program");
}

#[test]
fn a_submission_of_answers_alone_is_compiled_without_a_box() {
    let dir = workspace("mixed-compile-answers");
    let runtime = runtime_of(&dir, "0", CLEAN_LOG, NOTHING);
    let compiled = mixed("1.in")
        .compile(
            &compilation(&[(ANSWER, ANSWER_DIGEST)]),
            &StubToolchain,
            &runtime,
            Box::new(store_of(&dir)),
        )
        .expect("the compilation must be decided");

    assert!(compiled.success);
    assert_eq!(compiled.compilation_success, Some(true));
    assert_eq!(compiled.text, vec!["No compilation needed"]);
    assert!(
        compiled.sandboxes.is_empty() && compiled.executables.is_empty(),
        "an answer is not a source, so no box is made"
    );
    assert!(compiled.stats.is_none() && compiled.diagnostics.is_empty());
}

#[test]
fn a_carried_answer_wins_over_the_run_and_says_which_kind_of_testcase_it_is() {
    let listed = mixed("1.in");
    let unlisted = mixed("3.in");
    for (task, kind) in [(&listed, "outputonly"), (&unlisted, "batch")] {
        let dir = workspace("mixed-carried");
        let runtime = runtime_of(&dir, "0", CLEAN_LOG, &answered());
        let job = evaluation(
            TESTCASE,
            &[(ANSWER, ANSWER_DIGEST)],
            &[(EXECUTABLE, PROGRAM_DIGEST)],
        );
        let judged = task
            .evaluate(&job, &StubToolchain, &runtime, Box::new(store_of(&dir)))
            .expect("the evaluation must be decided");

        assert!(judged.success);
        assert_eq!(judged.outcome, None, "a carried answer is not judged here");
        let Some(Origin::Carried(answer)) = judged.origin else {
            panic!("the answer the submission carried");
        };
        assert_eq!(answer.as_str(), ANSWER_DIGEST);
        assert_eq!(
            judged.extra_args,
            vec![kind],
            "a checker is told which kind of testcase it is judging"
        );
        assert!(
            judged.sandboxes.is_empty() && judged.stats.is_none(),
            "a carried answer needs no executable and so no run"
        );
    }
}

#[test]
fn a_testcase_the_dataset_listed_as_output_only_is_never_run() {
    let dir = workspace("mixed-listed");
    let runtime = runtime_of(&dir, "0", CLEAN_LOG, &answered());
    let job = evaluation(TESTCASE, &[], &[(EXECUTABLE, PROGRAM_DIGEST)]);
    let judged = mixed("1.in")
        .evaluate(&job, &StubToolchain, &runtime, Box::new(store_of(&dir)))
        .expect("the evaluation must be decided");

    assert!(judged.success);
    assert_eq!(judged.outcome, Some(0.0));
    assert_eq!(judged.text, vec!["File not submitted"]);
    assert!(judged.origin.is_none() && judged.extra_args.is_empty());
    assert!(
        judged.sandboxes.is_empty(),
        "a program is not what answers an output-only testcase"
    );
}

#[test]
fn a_testcase_nobody_carried_an_answer_for_runs_the_executable() {
    let dir = workspace("mixed-run");
    let runtime = runtime_of(&dir, "0", CLEAN_LOG, &answered());
    let job = evaluation(TESTCASE, &[], &[(EXECUTABLE, PROGRAM_DIGEST)]);
    let judged = mixed("2.in")
        .evaluate(&job, &StubToolchain, &runtime, Box::new(store_of(&dir)))
        .expect("the evaluation must run");

    assert!(judged.success);
    assert_eq!(judged.outcome, None, "the run's answer is not judged here");
    assert!(judged.text.is_empty());
    let Some(Origin::Written(answer)) = judged.origin else {
        panic!("the answer the run wrote");
    };
    assert!(answer.path.ends_with("output.txt") && answer.filename.is_empty());
    assert_eq!(judged.extra_args, vec!["batch"]);
    assert_eq!(judged.sandboxes.len(), 1);
    assert_eq!(
        judged.stats.as_ref().map(|s| s.exit_status),
        Some(ExitStatus::Ok)
    );
    assert_eq!(
        staged(&judged.sandboxes[0]),
        vec!["flags.txt", "input.txt", "output.txt", "sol"]
    );
}

#[test]
fn a_run_that_wrote_no_answer_hands_nothing_on_and_says_why() {
    let dir = workspace("mixed-silent");
    let runtime = runtime_of(&dir, "0", CLEAN_LOG, NOTHING);
    let job = evaluation(TESTCASE, &[], &[(EXECUTABLE, PROGRAM_DIGEST)]);
    let judged = mixed("2.in")
        .evaluate(&job, &StubToolchain, &runtime, Box::new(store_of(&dir)))
        .expect("the evaluation must run");

    assert!(judged.success, "the box worked, so the run is judged");
    assert_eq!(judged.outcome, Some(0.0));
    assert_eq!(
        judged.text,
        vec!["Evaluation didn't produce file", "output.txt"]
    );
    assert!(
        judged.origin.is_none() && judged.extra_args.is_empty(),
        "there is no answer for a checker to be handed"
    );
}

#[test]
fn the_refusals_are_asked_before_anything_runs() {
    let refused = |job: &EvaluationJob, label: &str| {
        let dir = workspace(label);
        let runtime = runtime_of(&dir, "0", CLEAN_LOG, &answered());
        mixed("2.in").evaluate(job, &StubToolchain, &runtime, Box::new(store_of(&dir)))
    };

    let unadmitted = refused(
        &evaluation(TESTCASE, &[(ANSWER, UNADMITTED)], &[]),
        "refuse-digest",
    );
    assert!(
        matches!(unadmitted, Err(TaskError::Stage(StageError::Digest(_)))),
        "a digest the domain does not admit is not an answer"
    );

    let two = refused(
        &evaluation(
            TESTCASE,
            &[],
            &[(EXECUTABLE, PROGRAM_DIGEST), ("other", INPUT_DIGEST)],
        ),
        "refuse-count",
    );
    assert!(
        matches!(
            two,
            Err(TaskError::UnexpectedExecutables {
                found: 2,
                wanted: 1
            })
        ),
        "a result of two executables names no one of them to run"
    );
}
