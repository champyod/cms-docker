//! The execution port dispatches typed jobs and writes the reference's result bodies.

#[path = "tasktypes_helpers.rs"]
mod support;

use std::path::PathBuf;

use cms_grading::execute::{compile, evaluate};
use cms_grading::stage::FsCache;
use cms_grading::tasktypes::{Compilation, Evaluation, Runtime, TaskError, TaskType};
use serde_json::{json, Map, Value};

use support::{
    compile_job, digests, evaluate_job, runtime_of, store_of, workspace, StubToolchain, CLEAN_LOG,
    NOTHING, PROGRAM_DIGEST, SOURCE_DIGEST,
};

fn fixture(test: &str) -> (PathBuf, Runtime, FsCache) {
    let dir = workspace(test);
    let runtime = runtime_of(&dir, "0", CLEAN_LOG, NOTHING);
    let store = store_of(&dir);
    (dir, runtime, store)
}

fn batch() -> TaskType {
    TaskType::of("Batch", &json!(["alone", ["", ""], "diff"])).expect("a Batch task")
}

fn output_only() -> TaskType {
    TaskType::of("OutputOnly", &json!(["diff"])).expect("an OutputOnly task")
}

fn compilation_body(result: &Compilation) -> Value {
    let mut body = Map::new();
    result.write_body(&mut body);
    Value::Object(body)
}

fn evaluation_body(result: &Evaluation) -> Value {
    let mut body = Map::new();
    result.write_body(&mut body);
    Value::Object(body)
}

fn failed_compilation_body() -> Value {
    json!({
        "success": false,
        "compilation_success": null,
        "text": null,
        "plus": null,
        "sandboxes": [],
        "sandbox_digests": {},
        "executables": {}
    })
}

fn failed_evaluation_body() -> Value {
    json!({
        "success": false,
        "outcome": null,
        "text": null,
        "plus": null,
        "sandboxes": [],
        "sandbox_digests": {},
        "admin_text": null,
        "user_output": null
    })
}

#[test]
fn output_only_compilation_writes_the_no_compilation_result() {
    let (_dir, runtime, store) = fixture("execute-output-only-compile");
    let job = compile_job(Default::default());

    let result = compile(&output_only(), &job, None, &runtime, Box::new(store))
        .expect("OutputOnly needs no toolchain");

    assert_eq!(
        compilation_body(&result),
        json!({
            "success": true,
            "compilation_success": true,
            "text": ["No compilation needed"],
            "plus": {},
            "sandboxes": [],
            "sandbox_digests": {},
        "sandbox_digests": {},
            "executables": {}
        })
    );
}

#[test]
fn batch_compilation_with_zero_files_writes_a_configuration_error() {
    let (_dir, runtime, store) = fixture("execute-batch-no-files");
    let mut job = compile_job(Default::default());
    job.files.clear();

    let result = compile(
        &batch(),
        &job,
        Some(&StubToolchain),
        &runtime,
        Box::new(store),
    )
    .expect("a configuration error is a failed job, not a worker error");

    assert_eq!(compilation_body(&result), failed_compilation_body());
}

#[test]
fn batch_compilation_with_a_missing_grader_writes_a_configuration_error() {
    let (_dir, runtime, store) = fixture("execute-batch-no-grader");
    let task =
        TaskType::of("Batch", &json!(["grader", ["", ""], "diff"])).expect("a grader Batch task");

    let result = compile(
        &task,
        &compile_job(Default::default()),
        Some(&StubToolchain),
        &runtime,
        Box::new(store),
    )
    .expect("a missing grader is a configuration error");

    assert_eq!(compilation_body(&result), failed_compilation_body());
}

#[test]
fn batch_compilation_without_a_toolchain_refuses_the_job() {
    let (_dir, runtime, store) = fixture("execute-batch-no-language");
    let job = compile_job(Default::default());

    let result = compile(&batch(), &job, None, &runtime, Box::new(store));

    assert!(matches!(result, Err(TaskError::NoLanguage)));
}

#[test]
fn batch_evaluation_with_zero_executables_writes_a_configuration_error() {
    let (_dir, runtime, store) = fixture("execute-batch-no-executables");

    let result = evaluate(
        &batch(),
        &evaluate_job(Default::default()),
        Some(&StubToolchain),
        &runtime,
        Box::new(store),
    )
    .expect("a configuration error is a failed job, not a worker error");

    assert_eq!(evaluation_body(&result), failed_evaluation_body());
}

#[test]
fn a_missing_communication_manager_is_a_failed_job_result() {
    let (_dir, runtime, store) = fixture("execute-communication-no-manager");
    let mut job = evaluate_job(digests(&[("sol", PROGRAM_DIGEST)]));
    job.managers.clear();
    let task = TaskType::of("Communication", &json!([1, "alone", "std_io"]))
        .expect("a Communication task");

    let result = evaluate(&task, &job, Some(&StubToolchain), &runtime, Box::new(store))
        .expect("a missing manager is a configuration error");

    assert_eq!(evaluation_body(&result), failed_evaluation_body());
}

#[test]
fn a_missing_checker_is_a_failed_job_result() {
    let (_dir, runtime, store) = fixture("execute-output-only-no-checker");
    let mut job = evaluate_job(Default::default());
    job.files
        .insert("output_1.in.txt".to_owned(), SOURCE_DIGEST.to_owned());
    let task =
        TaskType::of("OutputOnly", &json!(["comparator"])).expect("a comparator OutputOnly task");

    let result = evaluate(&task, &job, None, &runtime, Box::new(store))
        .expect("a missing checker is a failed job, not a worker error");

    assert_eq!(evaluation_body(&result), failed_evaluation_body());
}

#[test]
fn a_nonpositive_limit_still_refuses_the_whole_job() {
    let (_dir, runtime, store) = fixture("execute-batch-no-limit");
    let mut job = evaluate_job(digests(&[("sol", PROGRAM_DIGEST)]));
    job.time_limit = Some(0.0);

    let result = evaluate(
        &batch(),
        &job,
        Some(&StubToolchain),
        &runtime,
        Box::new(store),
    );

    assert!(matches!(
        result,
        Err(TaskError::NonPositiveLimit {
            limit: "time limit",
            value,
        }) if value == 0.0
    ));
}

#[test]
fn output_only_evaluation_writes_the_carried_answer_without_a_toolchain() {
    let (_dir, runtime, store) = fixture("execute-output-only-evaluate");
    let mut job = evaluate_job(Default::default());
    job.files
        .insert("output_1.in.txt".to_owned(), SOURCE_DIGEST.to_owned());

    let result = evaluate(&output_only(), &job, None, &runtime, Box::new(store))
        .expect("OutputOnly needs no toolchain");

    assert_eq!(
        evaluation_body(&result),
        json!({
            "success": true,
            "outcome": "1.0",
            "text": ["Output is correct"],
            "plus": {},
            "sandboxes": [],
            "sandbox_digests": {},
        "sandbox_digests": {},
            "admin_text": null,
            "user_output": null
        })
    );
}
