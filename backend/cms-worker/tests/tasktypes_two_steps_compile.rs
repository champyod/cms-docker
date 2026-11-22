//! Two Steps' compilation: the manager, its header, the two submitted sources and
//! the headers they are compiled against, in the order the reference hands them to
//! the compiler.
//!
//! Every test reads its claim back out of the box: the command the task type gave
//! the compiler, the files the box was handed, and the executable the report stores.
//! A missing header, a source whose header is not in the dataset, and a count that
//! is not two are each refused before the box exists.

#[path = "tasktypes_compile_helpers.rs"]
mod support;

use cms_proto::DigestMap;
use cms_sandbox::ExitStatus;
use cms_worker::tasktypes::{TaskError, TwoSteps};
use serde_json::json;

use support::{
    box_made, content_of, digests, handed, job_of, produced, runtime_of, store_of, words_of,
    workspace, CLEAN_LOG, CPP, CSHARP, FAILED_LOG, GRADER_DIGEST, HEADER_DIGEST, INPUT_DIGEST,
    NOTHING, PROGRAM_DIGEST, PYTHON, SOURCE_DIGEST,
};

/// The two files a submission carries; the manager and its header are the dataset's.
fn sources() -> DigestMap {
    digests(&[("b.%l", SOURCE_DIGEST), ("a.%l", GRADER_DIGEST)])
}

fn managers() -> DigestMap {
    digests(&[
        ("manager.cpp", PROGRAM_DIGEST),
        ("manager.h", HEADER_DIGEST),
        ("a.h", HEADER_DIGEST),
        ("b.h", HEADER_DIGEST),
        ("README", INPUT_DIGEST),
    ])
}

fn two_steps() -> TwoSteps {
    TwoSteps::new(&json!(["diff"])).expect("one parameter is a task")
}

#[test]
fn the_manager_its_header_and_each_source_with_its_header_reach_the_compiler_in_order() {
    let dir = workspace("two-steps-compile-order");
    let store = store_of(&dir);
    let runtime = runtime_of(&dir, "0", CLEAN_LOG, &produced("manager"));
    let compiled = two_steps()
        .compile(
            &job_of(sources(), json!(["diff"]), managers(), true),
            &CPP,
            &runtime,
            Box::new(store.clone()),
        )
        .expect("the compilation must run");

    assert!(compiled.success);
    assert_eq!(compiled.compilation_success, Some(true));
    let box_of = &compiled.sandboxes[0];
    assert_eq!(
        words_of(box_of),
        vec!["compile manager", "manager.cpp manager.h a.cpp a.h b.cpp b.h"],
        "the manager is the entry point and comes first, then its header, then each source with the header it is compiled against"
    );
    assert_eq!(
        handed(box_of, &["manager"]),
        vec!["a.cpp", "a.h", "b.cpp", "b.h", "flags.txt", "manager.cpp", "manager.h"],
        "the box holds the manager, its header and each source with its header, and no manager the language does not read"
    );
    let digest = compiled
        .executables
        .get("manager")
        .expect("the one executable is the manager, named with the language's extension");
    assert_eq!(content_of(&store, digest), b"the program");
}

#[test]
fn a_language_with_no_headers_is_compiled_without_any() {
    let dir = workspace("two-steps-compile-headerless");
    let store = store_of(&dir);
    let runtime = runtime_of(&dir, "0", CLEAN_LOG, &produced("manager"));
    let without = digests(&[
        ("manager.py", PROGRAM_DIGEST),
        ("manager.h", HEADER_DIGEST),
        ("README", INPUT_DIGEST),
    ]);
    let compiled = two_steps()
        .compile(
            &job_of(sources(), json!(["diff"]), without, true),
            &PYTHON,
            &runtime,
            Box::new(store.clone()),
        )
        .expect("the compilation must run");

    let box_of = &compiled.sandboxes[0];
    assert_eq!(
        words_of(box_of),
        vec!["compile manager", "manager.py a.py b.py"],
        "a header extension the language does not name puts no header in the command"
    );
    assert_eq!(
        handed(box_of, &["manager"]),
        vec!["a.py", "b.py", "flags.txt", "manager.py"],
        "and none in the box, even where the dataset holds one"
    );
    assert!(compiled.executables.contains_key("manager"));
}

#[test]
fn the_executable_is_the_manager_with_the_languages_own_extension() {
    let dir = workspace("two-steps-compile-extension");
    let store = store_of(&dir);
    let runtime = runtime_of(&dir, "0", CLEAN_LOG, &produced("manager.exe"));
    let compiled = two_steps()
        .compile(
            &job_of(
                sources(),
                json!(["diff"]),
                digests(&[("manager.cs", PROGRAM_DIGEST)]),
                true,
            ),
            &CSHARP,
            &runtime,
            Box::new(store.clone()),
        )
        .expect("the compilation must run");

    assert_eq!(
        words_of(&compiled.sandboxes[0]),
        vec!["compile manager.exe", "manager.cs a.cs b.cs"],
        "the name is `manager` in every language, with that language's extension"
    );
    assert!(compiled.executables.contains_key("manager.exe"));
}

#[test]
fn a_submission_that_does_not_carry_exactly_two_files_is_refused() {
    let dir = workspace("two-steps-compile-count");
    let runtime = runtime_of(&dir, "0", CLEAN_LOG, NOTHING);
    let one = digests(&[("a.%l", SOURCE_DIGEST)]);
    let three = digests(&[
        ("a.%l", SOURCE_DIGEST),
        ("b.%l", GRADER_DIGEST),
        ("c.%l", HEADER_DIGEST),
    ]);

    for (files, found) in [(one, 1), (three, 3)] {
        let refused = two_steps().compile(
            &job_of(files, json!(["diff"]), managers(), true),
            &CPP,
            &runtime,
            Box::new(store_of(&dir)),
        );
        assert!(
            matches!(refused, Err(TaskError::TooFewFiles { found: seen, wanted: 2 }) if seen == found),
            "two files are required, not {found}"
        );
    }
    assert!(
        !box_made(&dir),
        "the count is read before the box exists, so a wrong one makes no box"
    );
}

#[test]
fn a_missing_header_is_refused_before_a_box_is_made() {
    let dir = workspace("two-steps-compile-no-header");
    let runtime = runtime_of(&dir, "0", CLEAN_LOG, &produced("manager"));

    let no_manager_header = digests(&[
        ("manager.cpp", PROGRAM_DIGEST),
        ("a.h", HEADER_DIGEST),
        ("b.h", HEADER_DIGEST),
    ]);
    let refused = two_steps().compile(
        &job_of(sources(), json!(["diff"]), no_manager_header, true),
        &CPP,
        &runtime,
        Box::new(store_of(&dir)),
    );
    assert!(
        matches!(&refused, Err(TaskError::MissingManager { name }) if name == "manager.h"),
        "the manager's header is a dataset file like the manager: {refused:?}"
    );

    let no_user_header = digests(&[
        ("manager.cpp", PROGRAM_DIGEST),
        ("manager.h", HEADER_DIGEST),
        ("a.h", HEADER_DIGEST),
    ]);
    let refused = two_steps().compile(
        &job_of(sources(), json!(["diff"]), no_user_header, true),
        &CPP,
        &runtime,
        Box::new(store_of(&dir)),
    );
    assert!(
        matches!(&refused, Err(TaskError::MissingManager { name }) if name == "b.h"),
        "a submitted source's header comes from the dataset too: {refused:?}"
    );
    assert!(!box_made(&dir));
}

#[test]
fn a_failed_compilation_stores_no_executable() {
    let dir = workspace("two-steps-compile-failed");
    let runtime = runtime_of(&dir, "1", FAILED_LOG, NOTHING);
    let compiled = two_steps()
        .compile(
            &job_of(sources(), json!(["diff"]), managers(), true),
            &CPP,
            &runtime,
            Box::new(store_of(&dir)),
        )
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
