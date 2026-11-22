//! Communication's compilation: the stub, the submitted sources and the managers
//! the language reads, in the order the reference hands them over.
//!
//! Every test reads its claim back out of the box: the command the task type gave
//! the compiler, the files the box was handed, and the executable it stored.

#[path = "tasktypes_compile_helpers.rs"]
mod support;

use cms_grading::job::CompilationJob;
use cms_grading::tasktypes::{Communication, TaskError};
use cms_proto::DigestMap;
use cms_sandbox::ExitStatus;
use serde_json::json;

use support::{
    box_made, content_of, digests, handed, job_of, produced, runtime_of, store_of, words_of,
    workspace, CLEAN_LOG, CPP, CSHARP, FAILED_LOG, GRADER_DIGEST, HEADER_DIGEST, INPUT_DIGEST,
    NOTHING, PROGRAM_DIGEST, SANDBOX_ERROR_LOG, SOURCE_DIGEST,
};

/// The two files a submission carries, named so that the sorted executable name
/// (`a_b`) is not the order the sources arrive in.
fn sources() -> DigestMap {
    digests(&[("b.%l", GRADER_DIGEST), ("a.%l", SOURCE_DIGEST)])
}

/// The dataset: the stub, a source and a header the language reads, and one of
/// each it does not.
fn managers() -> DigestMap {
    digests(&[
        ("manager", PROGRAM_DIGEST),
        ("stub.cpp", HEADER_DIGEST),
        ("grader.cpp", PROGRAM_DIGEST),
        ("notes.h", HEADER_DIGEST),
        ("README", INPUT_DIGEST),
    ])
}

fn with_stub() -> Communication {
    Communication::new(&json!([2, "stub", "fifo_io"])).expect("three parameters are a task")
}

fn alone() -> Communication {
    Communication::new(&json!([1, "alone", "std_io"])).expect("three parameters are a task")
}

/// The fixture's stub compilation; `archive` is whether the job keeps its box.
fn stub_job(archive: bool) -> CompilationJob {
    job_of(
        sources(),
        json!([2, "stub", "fifo_io"]),
        managers(),
        archive,
    )
}

#[test]
fn the_stub_comes_first_and_only_the_managers_the_language_reads_are_copied() {
    let dir = workspace("communication-compile-order");
    let store = store_of(&dir);
    let runtime = runtime_of(&dir, "0", CLEAN_LOG, &produced("a_b"));
    let compiled = with_stub()
        .compile(&stub_job(true), &CPP, &runtime, Box::new(store.clone()))
        .expect("the compilation must run");

    assert!(compiled.success);
    assert_eq!(compiled.compilation_success, Some(true));
    let box_of = &compiled.sandboxes[0];
    assert_eq!(
        words_of(box_of),
        vec!["compile a_b", "stub.cpp a.cpp b.cpp"],
        "the stub is the entry point, then the sources in codename order, and a manager with no extension the language reads is not compiled"
    );
    assert_eq!(
        handed(box_of, &["a_b"]),
        vec!["a.cpp", "b.cpp", "flags.txt", "grader.cpp", "notes.h", "stub.cpp"],
        "the box holds the stub, the sources and the managers `is_manager_for_compilation` accepts, and nothing else"
    );
    let digest = compiled
        .executables
        .get("a_b")
        .expect("the executable is named after the codenames, not after the stub");
    assert_eq!(content_of(&store, digest), b"the program");
}

#[test]
fn a_compilation_with_no_stub_compiles_the_sources_alone() {
    let dir = workspace("communication-compile-alone");
    let store = store_of(&dir);
    let runtime = runtime_of(&dir, "0", CLEAN_LOG, &produced("a_b"));
    let without = digests(&[
        ("manager", PROGRAM_DIGEST),
        ("grader.cpp", PROGRAM_DIGEST),
        ("README", INPUT_DIGEST),
    ]);
    let compiled = alone()
        .compile(
            &job_of(sources(), json!([1, "alone", "std_io"]), without, true),
            &CPP,
            &runtime,
            Box::new(store.clone()),
        )
        .expect("the compilation must run");

    let box_of = &compiled.sandboxes[0];
    assert_eq!(
        words_of(box_of),
        vec!["compile a_b", "a.cpp b.cpp"],
        "a task compiled alone reads no stub even where the dataset holds one"
    );
    assert_eq!(
        handed(box_of, &["a_b"]),
        vec!["a.cpp", "b.cpp", "flags.txt", "grader.cpp"],
        "the manager with no extension is not a file this language reads"
    );
    assert!(compiled.executables.contains_key("a_b"));
}

#[test]
fn the_executable_takes_the_languages_extension_after_the_codenames() {
    let dir = workspace("communication-compile-extension");
    let store = store_of(&dir);
    let runtime = runtime_of(&dir, "0", CLEAN_LOG, &produced("a.exe"));
    let compiled = alone()
        .compile(
            &job_of(
                digests(&[("a.%l", SOURCE_DIGEST)]),
                json!([1, "alone", "std_io"]),
                DigestMap::new(),
                true,
            ),
            &CSHARP,
            &runtime,
            Box::new(store.clone()),
        )
        .expect("the compilation must run");

    assert_eq!(
        words_of(&compiled.sandboxes[0]),
        vec!["compile a.exe", "a.cs"],
        "the name is the codename without its placeholder and the language's own extension"
    );
    assert!(compiled.executables.contains_key("a.exe"));
}

#[test]
fn a_stub_compilation_without_the_stub_is_refused_before_a_box_is_made() {
    let dir = workspace("communication-compile-no-stub");
    let runtime = runtime_of(&dir, "0", CLEAN_LOG, &produced("a_b"));
    let without = digests(&[("grader.cpp", PROGRAM_DIGEST), ("README", INPUT_DIGEST)]);
    let refused = with_stub().compile(
        &job_of(sources(), json!([2, "stub", "fifo_io"]), without, true),
        &CPP,
        &runtime,
        Box::new(store_of(&dir)),
    );

    assert!(
        matches!(&refused, Err(TaskError::MissingManager { name }) if name == "stub.cpp"),
        "a dataset without the stub cannot be compiled: {refused:?}"
    );
    assert!(
        !box_made(&dir),
        "the stub is looked for before the box exists, so a missing one makes no box"
    );
}

#[test]
fn a_submission_with_no_files_is_refused_before_a_box_is_made() {
    let dir = workspace("communication-compile-no-files");
    let runtime = runtime_of(&dir, "0", CLEAN_LOG, &produced("a_b"));
    let empty = job_of(
        DigestMap::new(),
        json!([2, "stub", "fifo_io"]),
        managers(),
        true,
    );
    let refused = with_stub().compile(&empty, &CPP, &runtime, Box::new(store_of(&dir)));

    assert!(
        matches!(
            refused,
            Err(TaskError::TooFewFiles {
                found: 0,
                wanted: 1
            })
        ),
        "one file is the floor a Communication compilation is attempted for"
    );
    assert!(!box_made(&dir));
}

#[test]
fn a_failed_compilation_stores_no_executable() {
    let dir = workspace("communication-compile-failed");
    let runtime = runtime_of(&dir, "1", FAILED_LOG, NOTHING);
    let compiled = with_stub()
        .compile(&stub_job(true), &CPP, &runtime, Box::new(store_of(&dir)))
        .expect("the compilation must run");

    assert!(compiled.success, "the box worked, so the run is judged");
    assert_eq!(compiled.compilation_success, Some(false));
    assert_eq!(compiled.text, vec!["Compilation failed"]);
    assert!(
        compiled.executables.is_empty(),
        "an executable is stored only where the compilation produced one"
    );
    assert_eq!(
        compiled.stats.as_ref().map(|stats| stats.exit_status),
        Some(ExitStatus::NonzeroReturn)
    );
}

#[test]
fn a_box_that_did_not_work_is_kept_and_one_that_did_is_removed() {
    let broken = workspace("communication-compile-kept");
    let runtime = runtime_of(&broken, "1", SANDBOX_ERROR_LOG, NOTHING);
    let compiled = with_stub()
        .compile(
            &stub_job(false),
            &CPP,
            &runtime,
            Box::new(store_of(&broken)),
        )
        .expect("the compilation must run");
    assert!(!compiled.success, "the box did not work");
    assert_eq!(compiled.compilation_success, None);
    assert!(
        compiled.sandboxes[0].is_dir(),
        "a box that did not work is kept even where the job did not ask for it"
    );

    let failed = workspace("communication-compile-failed-in-a-box");
    let runtime = runtime_of(&failed, "1", FAILED_LOG, NOTHING);
    let compiled = with_stub()
        .compile(
            &stub_job(false),
            &CPP,
            &runtime,
            Box::new(store_of(&failed)),
        )
        .expect("the compilation must run");
    assert!(compiled.success && compiled.compilation_success == Some(false));
    assert!(
        !compiled.sandboxes[0].exists(),
        "a compilation that failed inside a box that worked is not a box to keep"
    );
}
