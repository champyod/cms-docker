#[path = "tasktypes_archive_assertions.rs"]
mod assertions;
#[path = "tasktypes_helpers.rs"]
mod helpers;

use assertions::{assert_archived, assert_body_pair};

use cms_grading::execute::{compile, evaluate};
use cms_grading::stage::ArchiveError;
use cms_grading::tasktypes::{Batch, TaskError, TaskType};
use cms_proto::DigestMap;
use serde_json::{json, Map};

use helpers::{
    answered, compile_job, digests, evaluate_job, managers, produced, runtime_of, store_of,
    workspace, StubToolchain, CLEAN_LOG, EXECUTABLE, GRADER_DIGEST, NOTHING, PROGRAM_DIGEST,
    SOURCE_DIGEST,
};

const SANDBOX_ERROR_LOG: &str = "time:0.5\ntime-wall:1.5\ncg-mem:2048\nstatus:XX\nexitcode:1\n";
const ARCHIVE_NAME: &str = "sandbox-archive.tar.gz";

fn alone() -> Batch {
    Batch::new(&json!(["alone", ["", ""], "diff"])).expect("three parameters are a task")
}

#[test]
fn a_successful_archived_compilation_is_filed_and_kept_as_asked() {
    for keep in [false, true] {
        let label = if keep {
            "archive-compile-kept"
        } else {
            "archive-compile-removed"
        };
        let dir = workspace(label);
        let store = store_of(&dir);
        let runtime =
            runtime_of(&dir, "0", CLEAN_LOG, &produced(EXECUTABLE)).with_keep_sandbox(keep);
        let mut job = compile_job(managers());
        job.archive_sandbox = true;

        let compiled = alone()
            .compile(&job, &StubToolchain, &runtime, Box::new(store.clone()))
            .expect("the compilation must run");

        assert!(compiled.success);
        assert_eq!(compiled.sandboxes.len(), 1);
        assert_archived(&store, &compiled.sandboxes, &compiled.sandbox_digests);
        assert_eq!(compiled.sandboxes[0].is_dir(), keep);

        let mut body = Map::new();
        compiled.write_body(&mut body);
        assert_body_pair(&body, &compiled.sandboxes, &compiled.sandbox_digests);
    }
}

#[test]
fn a_failed_archived_compilation_keeps_its_archive_and_sandbox() {
    for keep in [false, true] {
        let label = if keep {
            "archive-compile-failed-kept"
        } else {
            "archive-compile-failed-default"
        };
        let dir = workspace(label);
        let store = store_of(&dir);
        let runtime = runtime_of(&dir, "0", SANDBOX_ERROR_LOG, NOTHING).with_keep_sandbox(keep);
        let mut job = compile_job(managers());
        job.archive_sandbox = true;

        let compiled = alone()
            .compile(&job, &StubToolchain, &runtime, Box::new(store.clone()))
            .expect("a failed box is a result, not a worker error");

        assert!(!compiled.success);
        assert_eq!(compiled.sandboxes.len(), 1);
        assert_archived(&store, &compiled.sandboxes, &compiled.sandbox_digests);
        assert!(compiled.sandboxes[0].is_dir());
    }
}

#[test]
fn an_archive_refusal_fails_the_group_and_keeps_the_box() {
    let dir = workspace("archive-compile-refused");
    let store = store_of(&dir);
    let leaves = format!(
        "{}\nprintf 'occupied' > \"$home/{ARCHIVE_NAME}\"\n{NOTHING}",
        produced(EXECUTABLE)
    );
    let runtime = runtime_of(&dir, "0", CLEAN_LOG, &leaves);
    let task = TaskType::of("Batch", &json!(["alone", ["", ""], "diff"])).expect("a Batch task");
    let mut job = compile_job(managers());
    job.archive_sandbox = true;

    let refused = compile(&task, &job, Some(&StubToolchain), &runtime, Box::new(store));

    assert!(
        matches!(refused, Err(TaskError::Archive(ArchiveError::Store { .. }))),
        "{refused:?}"
    );
    assert!(dir.join("cms-sandbox-compile").is_dir());
}

#[test]
fn disabling_archive_leaves_the_result_map_and_body_empty() {
    for keep in [false, true] {
        let label = if keep {
            "archive-disabled-kept"
        } else {
            "archive-disabled-removed"
        };
        let dir = workspace(label);
        let store = store_of(&dir);
        let runtime =
            runtime_of(&dir, "0", CLEAN_LOG, &produced(EXECUTABLE)).with_keep_sandbox(keep);
        let mut job = compile_job(managers());
        job.archive_sandbox = false;

        let compiled = alone()
            .compile(&job, &StubToolchain, &runtime, Box::new(store.clone()))
            .expect("the compilation must run");

        assert!(compiled.success);
        assert_eq!(compiled.sandboxes.len(), 1);
        assert!(compiled.sandbox_digests.is_empty());
        assert_eq!(compiled.sandboxes[0].is_dir(), keep);
        let mut body = Map::new();
        compiled.write_body(&mut body);
        assert_body_pair(&body, &compiled.sandboxes, &compiled.sandbox_digests);
        assert_eq!(body["sandbox_digests"], json!({}));
    }
}

#[test]
fn a_batch_and_output_submission_without_sources_has_no_archive() {
    let dir = workspace("archive-mixed-no-source");
    let store = store_of(&dir);
    let runtime = runtime_of(&dir, "0", CLEAN_LOG, NOTHING);
    let task = TaskType::of("BatchAndOutput", &json!(["alone", ["", ""], "diff", ""]))
        .expect("a BatchAndOutput task");
    let mut job = compile_job(managers());
    job.files.clear();

    let compiled = compile(&task, &job, None, &runtime, Box::new(store))
        .expect("an answer-only submission needs no compilation");

    assert!(compiled.success);
    assert!(compiled.sandboxes.is_empty());
    assert!(compiled.sandbox_digests.is_empty());
    let mut body = Map::new();
    compiled.write_body(&mut body);
    assert_body_pair(&body, &compiled.sandboxes, &compiled.sandbox_digests);
    assert_eq!(body["sandbox_digests"], json!({}));
}

#[test]
fn an_archived_evaluation_and_checker_are_keyed_by_their_own_paths() {
    for keep in [false, true] {
        let label = if keep {
            "archive-evaluate-checker-kept"
        } else {
            "archive-evaluate-checker-removed"
        };
        let dir = workspace(label);
        let store = store_of(&dir);
        let verdict = "if [ -n \"$out\" ]; then printf 'the answer' > \"$home/${out##*/}\"; \
                       else printf '1.0\\n'; printf 'Output is correct\\n' >&2; fi\n:";
        let runtime = runtime_of(&dir, "0", CLEAN_LOG, verdict).with_keep_sandbox(keep);
        let mut job = evaluate_job(digests(&[(EXECUTABLE, PROGRAM_DIGEST)]));
        job.managers = digests(&[("checker", GRADER_DIGEST)]);
        job.archive_sandbox = true;
        let comparator = Batch::new(&json!(["alone", ["", ""], "comparator"]))
            .expect("three parameters are a task");

        let evaluated = comparator
            .evaluate(&job, &StubToolchain, &runtime, Box::new(store.clone()))
            .expect("the evaluation and check must run");

        assert!(evaluated.success);
        assert_eq!(evaluated.sandboxes.len(), 2);
        assert_archived(&store, &evaluated.sandboxes, &evaluated.sandbox_digests);
        assert!(evaluated.sandboxes.iter().all(|path| path.is_dir() == keep));
        let mut body = Map::new();
        evaluated.write_body(&mut body);
        assert_body_pair(&body, &evaluated.sandboxes, &evaluated.sandbox_digests);
    }
}

#[test]
fn a_batch_and_output_run_carries_its_archive_digest_to_the_body() {
    for keep in [false, true] {
        let label = if keep {
            "archive-mixed-run-kept"
        } else {
            "archive-mixed-run-removed"
        };
        let dir = workspace(label);
        let store = store_of(&dir);
        let runtime = runtime_of(&dir, "0", CLEAN_LOG, &answered()).with_keep_sandbox(keep);
        let task = TaskType::of("BatchAndOutput", &json!(["alone", ["", ""], "diff", ""]))
            .expect("a BatchAndOutput task");

        let mut job = evaluate_job(digests(&[(EXECUTABLE, PROGRAM_DIGEST)]));
        job.archive_sandbox = true;
        let evaluated = evaluate(
            &task,
            &job,
            Some(&StubToolchain),
            &runtime,
            Box::new(store.clone()),
        )
        .expect("the run is evaluated");

        assert!(evaluated.success);
        assert_eq!(evaluated.sandboxes.len(), 1);
        assert_archived(&store, &evaluated.sandboxes, &evaluated.sandbox_digests);
        assert_eq!(evaluated.sandboxes[0].is_dir(), keep);
        let mut body = Map::new();
        evaluated.write_body(&mut body);
        assert_body_pair(&body, &evaluated.sandboxes, &evaluated.sandbox_digests);
    }
}

#[test]
fn output_only_checker_archives_follow_the_job_flag() {
    for (archive, keep, label) in [
        (true, false, "archive-output-only"),
        (true, true, "archive-output-only-kept"),
        (false, false, "archive-output-only-off"),
        (false, true, "archive-output-only-off-kept"),
    ] {
        let dir = workspace(label);
        let store = store_of(&dir);
        let verdict = "printf '1.0\\n'; printf 'Output is correct\\n' >&2\n:";
        let runtime = runtime_of(&dir, "0", CLEAN_LOG, verdict).with_keep_sandbox(keep);
        let task = TaskType::of("OutputOnly", &json!(["comparator"]))
            .expect("an OutputOnly comparator task");
        let mut job = evaluate_job(DigestMap::new());
        job.files
            .insert("output_1.in.txt".to_owned(), SOURCE_DIGEST.to_owned());
        job.managers = digests(&[("checker", GRADER_DIGEST)]);
        job.archive_sandbox = archive;

        let evaluated = evaluate(&task, &job, None, &runtime, Box::new(store.clone()))
            .expect("the carried answer is judged by the checker");

        assert!(evaluated.success);
        assert_eq!(evaluated.sandboxes.len(), 1);
        if archive {
            assert_archived(&store, &evaluated.sandboxes, &evaluated.sandbox_digests);
        } else {
            assert!(evaluated.sandbox_digests.is_empty());
        }
        assert_eq!(evaluated.sandboxes[0].is_dir(), keep);
        let mut body = Map::new();
        evaluated.write_body(&mut body);
        assert_body_pair(&body, &evaluated.sandboxes, &evaluated.sandbox_digests);
    }
}
