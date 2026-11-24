//! Every registry variant reaches its own compilation and evaluation phase.

#[path = "tasktypes_helpers.rs"]
mod support;

use cms_grading::execute::{compile, evaluate};
use cms_grading::tasktypes::TaskType;
use serde_json::{json, Value};

use support::{
    compile_job, content_of, digests, evaluate_job, runtime_of, store_of, workspace, StubToolchain,
    CLEAN_LOG, NOTHING, PROGRAM_DIGEST,
};

#[test]
fn compilation_dispatches_all_five_task_types() {
    let cases = [
        ("Batch", json!(["alone", ["", ""], "diff"]), false),
        (
            "BatchAndOutput",
            json!(["alone", ["", ""], "diff", ""]),
            true,
        ),
        ("OutputOnly", json!(["diff"]), true),
        ("TwoSteps", json!(["diff"]), false),
        ("Communication", json!([1, "alone", "std_io"]), false),
    ];
    for (index, (key, parameters, succeeds)) in cases.into_iter().enumerate() {
        let dir = workspace(&format!("execute-compile-dispatch-{index}"));
        let runtime = runtime_of(&dir, "0", CLEAN_LOG, NOTHING);
        let mut job = compile_job(Default::default());
        job.files.clear();
        let task = TaskType::of(key, &parameters).expect("a registered task type");

        let result = compile(
            &task,
            &job,
            (key != "OutputOnly").then_some(&StubToolchain),
            &runtime,
            Box::new(store_of(&dir)),
        )
        .expect("the selected compilation phase decides the result");

        assert_eq!(result.success, succeeds, "{key}");
        assert!(result.sandboxes.is_empty() && result.executables.is_empty());
    }
}

fn evaluation_cases() -> [(&'static str, Value, bool, bool, Option<&'static str>); 5] {
    [
        (
            "OutputOnly",
            json!(["diff"]),
            false,
            true,
            Some("File not submitted"),
        ),
        (
            "Batch",
            json!(["alone", ["", ""], "diff"]),
            false,
            false,
            None,
        ),
        (
            "BatchAndOutput",
            json!(["alone", ["", ""], "diff", ""]),
            false,
            true,
            Some("File not submitted"),
        ),
        ("TwoSteps", json!(["diff"]), false, false, None),
        (
            "Communication",
            json!([1, "alone", "std_io"]),
            true,
            false,
            None,
        ),
    ]
}

#[test]
fn evaluation_dispatches_all_five_task_types() {
    for (index, (key, parameters, executable, succeeds, text)) in
        evaluation_cases().into_iter().enumerate()
    {
        let dir = workspace(&format!("execute-evaluate-dispatch-{index}"));
        let runtime = runtime_of(&dir, "0", CLEAN_LOG, NOTHING);
        let executables = executable.then(|| digests(&[("sol", PROGRAM_DIGEST)]));
        let task = TaskType::of(key, &parameters).expect("a registered task type");

        let result = evaluate(
            &task,
            &evaluate_job(executables.unwrap_or_default()),
            (key != "OutputOnly").then_some(&StubToolchain),
            &runtime,
            Box::new(store_of(&dir)),
        )
        .expect("the selected evaluation phase decides the result");

        assert_eq!(result.success, succeeds, "{key}");
        match text {
            Some(text) => assert_eq!(
                result.text.as_deref(),
                Some([text.to_owned()].as_slice()),
                "{key}"
            ),
            None => assert!(result.text.is_none(), "{key}"),
        }
    }
}

#[test]
fn a_communication_verdict_maps_every_evaluation_field() {
    let dir = workspace("execute-communication-verdict");
    let runtime = runtime_of(
        &dir,
        "0",
        CLEAN_LOG,
        "printf '42.5\\n'; printf 'wrong answer\\n' >&2\n:",
    );
    let mut job = evaluate_job(digests(&[("sol", PROGRAM_DIGEST)]));
    job.managers
        .insert("manager".to_owned(), PROGRAM_DIGEST.to_owned());
    let task = TaskType::of("Communication", &json!([1, "alone", "std_io"]))
        .expect("a Communication task");

    let result = evaluate(
        &task,
        &job,
        Some(&StubToolchain),
        &runtime,
        Box::new(store_of(&dir)),
    )
    .expect("the manager decides the verdict");

    assert!(result.success && result.ran);
    assert_eq!(result.outcome, Some(42.5));
    assert_eq!(result.text, Some(vec!["wrong answer".to_owned()]));
    assert!(result.admin_text.is_none());
    assert!(result.stats.is_some());
    assert!(result.user_output.is_none());
    assert!(result.output_file.is_none());
    assert_eq!(result.sandboxes.len(), 2);
}

#[test]
fn a_batch_and_output_run_keeps_its_status_and_requested_answer() {
    let dir = workspace("execute-mixed-run");
    let store = store_of(&dir);
    let runtime = runtime_of(&dir, "0", CLEAN_LOG, &support::answered());
    let mut job = evaluate_job(digests(&[("sol", PROGRAM_DIGEST)]));
    job.get_output = Some(true);
    let task = TaskType::of("BatchAndOutput", &json!(["alone", ["", ""], "diff", ""]))
        .expect("a BatchAndOutput task");

    let result = evaluate(
        &task,
        &job,
        Some(&StubToolchain),
        &runtime,
        Box::new(store.clone()),
    )
    .expect("the run is evaluated");

    assert!(result.success && result.ran);
    assert!(result.stats.is_some() && result.output_file.is_some());
    let digest = result
        .user_output
        .as_ref()
        .expect("the requested answer is stored");
    assert_eq!(content_of(&store, digest.as_str()), b"the answer");
}
