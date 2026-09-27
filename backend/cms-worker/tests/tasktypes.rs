//! The Batch task type's parameters, and the compilation phase: the files a
//! submission is handed, the commands that turn them into an executable, and the
//! executable itself.
//!
//! The records, the stub language and the stub isolation program every test here
//! is decided by live beside this file, so a test is a claim about the task type
//! and nothing else: which files a compilation is handed, which flags its run is
//! held to, what it printed, and what the reference refuses before it is launched.

#[path = "tasktypes_helpers.rs"]
mod helpers;

use std::path::Path;

use cms_proto::DigestMap;
use cms_worker::tasktypes::{Batch, TaskError};
use cms_worker::ExitStatus;
use serde_json::json;

use helpers::{
    compilation_of, compile_job, content_of, dataset, digests, flags_of, managers, produced,
    runtime_of, staged, store_of, submission, workspace, StubToolchain, CLEAN_LOG, EXECUTABLE,
    FAILED_LOG, GRADER, HEADER, NOTHING, SOURCE_DIGEST,
};

/// The names a compilation command's two streams are redirected to.
const STDOUT_STREAM: &str = "compilation_stdout_0.txt";
const STDERR_STREAM: &str = "compilation_stderr_0.txt";
/// The package directory a Haskell compilation is given only where it is there.
const TOOLCHAIN_PACKAGES: &str = "/var/lib/ghc";

/// The parameters of a task that is compiled together with a grader the dataset
/// holds, which redirects both of its streams.
fn with_grader() -> Batch {
    Batch::new(&json!(["grader", ["", ""], "comparator"])).expect("three parameters are a task")
}

fn alone() -> Batch {
    Batch::new(&json!(["alone", ["", ""], "diff"])).expect("three parameters are a task")
}

/// The flags a run was held to, each of which the box must have been given.
fn held_to(flags: &str, expected: &[&str]) {
    for flag in expected {
        assert!(flags.contains(flag), "{flag} must be among {flags}");
    }
}

/// What a warned compilation is expected to have left behind: the executable, and
/// what the compiler printed on each of the two streams it was redirected to.
fn warned(program: &str) -> String {
    let streams = [
        (STDOUT_STREAM, "the notice"),
        (STDERR_STREAM, "the warning"),
    ];
    let printed: Vec<String> = streams
        .iter()
        .map(|(name, text)| format!("printf '{text}' > \"$home/{name}\""))
        .collect();
    format!("{}\n{}\n{NOTHING}", produced(program), printed.join("\n"))
}

#[test]
fn the_three_parameters_are_read_for_what_they_name() {
    let grader = with_grader();
    assert!(grader.uses_grader() && grader.uses_comparator());
    assert!(grader.redirects_stdin() && grader.redirects_stdout());
    assert_eq!(grader.actual_input(), "input.txt");
    assert_eq!(grader.actual_output(), "output.txt");
    assert_eq!(grader.output_filename(), "");
    assert_eq!(grader.main_of("sol.exe"), "grader");

    let named = Batch::new(&json!(["alone", ["in.txt", "out.txt"], "diff"]))
        .expect("three parameters are a task");
    assert!(!named.uses_grader() && !named.uses_comparator());
    assert!(!named.redirects_stdin() && !named.redirects_stdout());
    assert_eq!(named.actual_input(), "in.txt");
    assert_eq!(named.output_filename(), "out.txt");
    assert_eq!(named.main_of("sol.exe"), "sol");
}

#[test]
fn parameters_that_are_not_three_of_the_right_shape_are_refused() {
    for wrong in [
        json!([]),
        json!(["alone", ["in.txt"]]),
        json!(["alone", ["in.txt", "out.txt"]]),
        json!(["alone", ["in.txt", "out.txt"], "diff", "extra"]),
        json!([1, ["in.txt", "out.txt"], "diff"]),
    ] {
        assert!(
            matches!(Batch::new(&wrong), Err(TaskError::Parameters)),
            "{wrong} is not three parameters"
        );
    }
}

#[test]
fn a_compilation_hands_over_the_sources_and_the_managers_and_keeps_the_executable() {
    let dir = workspace("compile");
    let store = store_of(&dir);
    let runtime = runtime_of(&dir, "0", CLEAN_LOG, &produced(EXECUTABLE));
    let compiled = with_grader()
        .compile(
            &compile_job(managers()),
            &StubToolchain,
            &runtime,
            Box::new(store.clone()),
        )
        .expect("the compilation must run");

    assert!(compiled.success);
    assert_eq!(compiled.compilation_success, Some(true));
    assert_eq!(compiled.text, vec!["Compilation succeeded"]);
    assert_eq!(
        compiled.stats.as_ref().map(|s| s.exit_status),
        Some(ExitStatus::Ok)
    );
    let box_of = &compiled.sandboxes[0];
    assert_eq!(
        staged(box_of),
        vec!["flags.txt", "grader.cpp", "grader.h", "sol", "sol.cpp"],
        "the grader is compiled too, and the rest is what the language reads"
    );
    let digest = compiled
        .executables
        .get(EXECUTABLE)
        .expect("the executable");
    assert_eq!(content_of(&store, digest), b"the program");
    held_to(
        &flags_of(box_of),
        &[
            "--time=30",
            "--wall-time=61",
            "--cg-mem=65536",
            "--processes=4",
            "--stdout=/tmp/compilation_stdout_0.txt",
            "--full-env",
        ],
    );
}

#[test]
fn a_compilation_that_produced_nothing_is_a_failure_and_leaves_no_executable() {
    let dir = workspace("compile-failed");
    let runtime = runtime_of(&dir, "1", FAILED_LOG, NOTHING);
    let compiled = alone()
        .compile(
            &compile_job(managers()),
            &StubToolchain,
            &runtime,
            Box::new(store_of(&dir)),
        )
        .expect("the compilation must run");

    assert!(
        compiled.success,
        "the box worked, so the compilation is judged"
    );
    assert_eq!(compiled.compilation_success, Some(false));
    assert_eq!(compiled.text, vec!["Compilation failed"]);
    assert!(compiled.executables.is_empty());
    let silent = &compiled.diagnostics;
    assert!(silent.is_empty(), "a command that printed nothing is filed");
    assert_eq!(
        compiled.stats.as_ref().map(|s| s.exit_status),
        Some(ExitStatus::NonzeroReturn)
    );
}

#[test]
fn a_compilation_that_was_only_warned_about_keeps_what_the_compiler_printed() {
    let dir = workspace("compile-warned");
    let store = store_of(&dir);
    let runtime = runtime_of(&dir, "0", CLEAN_LOG, &warned(EXECUTABLE));
    let compiled = alone()
        .compile(
            &compile_job(managers()),
            &StubToolchain,
            &runtime,
            Box::new(store.clone()),
        )
        .expect("the compilation must run");

    assert!(compiled.success, "a warning is not a failure");
    assert_eq!(compiled.compilation_success, Some(true));
    let streams: Vec<&str> = compiled.diagnostics.keys().map(String::as_str).collect();
    assert_eq!(streams, vec![STDERR_STREAM, STDOUT_STREAM], "both streams");
    for (name, printed) in [
        (STDOUT_STREAM, "the notice"),
        (STDERR_STREAM, "the warning"),
    ] {
        let digest = compiled.diagnostics.get(name).expect("a filed stream");
        assert_eq!(content_of(&store, digest), printed.as_bytes());
    }
}

#[test]
fn a_compilation_sees_the_system_configuration_and_the_packages_where_there_are_any() {
    let dir = workspace("compile-directories");
    let runtime = runtime_of(&dir, "0", CLEAN_LOG, &produced(EXECUTABLE));
    let compiled = with_grader()
        .compile(
            &compile_job(managers()),
            &StubToolchain,
            &runtime,
            Box::new(store_of(&dir)),
        )
        .expect("the compilation must run");

    let flags = flags_of(&compiled.sandboxes[0]);
    held_to(&flags, &["--dir=/etc"]);
    let packages = format!("--dir={TOOLCHAIN_PACKAGES}");
    assert_eq!(
        flags.contains(&packages),
        Path::new(TOOLCHAIN_PACKAGES).exists(),
        "the package database is mapped only where the machine holds one"
    );
}

#[test]
fn a_submission_with_no_files_and_a_missing_grader_are_both_refused() {
    let dir = workspace("compile-refused");
    let runtime = runtime_of(&dir, "0", CLEAN_LOG, NOTHING);
    let batch = with_grader();
    let toolchain = StubToolchain;

    let mut empty = submission(DigestMap::new());
    empty.files.clear();
    let no_files = compilation_of(&empty, &dataset(managers()));
    assert!(
        matches!(
            batch.compile(&no_files, &toolchain, &runtime, Box::new(store_of(&dir))),
            Err(TaskError::TooFewFiles {
                found: 0,
                wanted: 1
            })
        ),
        "a submission with no file cannot be compiled"
    );

    let without = dataset(digests(&[(HEADER, SOURCE_DIGEST)]));
    let no_grader = compilation_of(&submission(DigestMap::new()), &without);
    let refused = batch.compile(&no_grader, &toolchain, &runtime, Box::new(store_of(&dir)));
    assert!(
        matches!(refused, Err(TaskError::MissingManager { name }) if name == GRADER),
        "a grader compilation with no grader manager is a configuration error"
    );
}
