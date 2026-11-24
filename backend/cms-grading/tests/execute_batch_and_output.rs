//! BatchAndOutput asks for a toolchain only when it reaches the Batch phase.

#[path = "tasktypes_helpers.rs"]
mod support;

use cms_grading::execute::{compile, evaluate};
use cms_grading::tasktypes::{TaskError, TaskType};
use serde_json::json;

use support::{
    compile_job, digests, evaluate_job, runtime_of, store_of, workspace, CLEAN_LOG, NOTHING,
    PROGRAM_DIGEST, SOURCE_DIGEST,
};

fn task(output_only: &str) -> TaskType {
    TaskType::of(
        "BatchAndOutput",
        &json!(["alone", ["", ""], "diff", output_only]),
    )
    .expect("a BatchAndOutput task")
}

#[test]
fn batch_and_output_compilation_without_source_or_toolchain_succeeds() {
    let dir = workspace("execute-mixed-no-source");
    let runtime = runtime_of(&dir, "0", CLEAN_LOG, NOTHING);
    let mut job = compile_job(Default::default());
    job.files = digests(&[("output_1.in.txt", SOURCE_DIGEST)]);

    let result = compile(&task(""), &job, None, &runtime, Box::new(store_of(&dir)))
        .expect("answer-only compilation needs no toolchain");

    assert!(result.success && result.compilation_success == Some(true));
    assert_eq!(result.text, Some(vec!["No compilation needed".to_owned()]));
    assert!(result.stats.is_none() && result.executables.is_empty());
}

#[test]
fn batch_and_output_carried_answer_needs_no_toolchain() {
    let dir = workspace("execute-mixed-carried-no-language");
    let runtime = runtime_of(&dir, "0", CLEAN_LOG, NOTHING);
    let mut job = evaluate_job(Default::default());
    job.files
        .insert("output_1.in.txt".to_owned(), SOURCE_DIGEST.to_owned());

    let result = evaluate(&task(""), &job, None, &runtime, Box::new(store_of(&dir)))
        .expect("a carried answer needs no toolchain");

    assert!(result.success && !result.ran);
    assert_eq!(result.outcome, Some(1.0));
    assert_eq!(result.text, Some(vec!["Output is correct".to_owned()]));
}

#[test]
fn batch_and_output_listed_testcase_needs_no_toolchain() {
    let dir = workspace("execute-mixed-listed-no-language");
    let runtime = runtime_of(&dir, "0", CLEAN_LOG, NOTHING);
    let job = evaluate_job(digests(&[("sol", PROGRAM_DIGEST)]));

    let result = evaluate(
        &task("1.in"),
        &job,
        None,
        &runtime,
        Box::new(store_of(&dir)),
    )
    .expect("a listed output-only testcase never runs Batch");

    assert!(result.success && !result.ran);
    assert_eq!(result.outcome, Some(0.0));
    assert_eq!(result.text, Some(vec!["File not submitted".to_owned()]));
}

#[test]
fn batch_and_output_batch_run_without_a_toolchain_refuses_the_job() {
    let dir = workspace("execute-mixed-run-no-language");
    let runtime = runtime_of(&dir, "0", CLEAN_LOG, NOTHING);
    let job = evaluate_job(digests(&[("sol", PROGRAM_DIGEST)]));

    let result = evaluate(&task(""), &job, None, &runtime, Box::new(store_of(&dir)));

    assert!(matches!(result, Err(TaskError::NoLanguage)));
}
