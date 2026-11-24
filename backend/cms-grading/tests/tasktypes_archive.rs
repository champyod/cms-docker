#[path = "tasktypes_helpers.rs"]
mod helpers;

use std::path::PathBuf;

use cms_grading::execute::compile;
use cms_grading::stage::{ArchiveError, FsCache};
use cms_grading::tasktypes::{Batch, TaskError, TaskType};
use cms_proto::DigestMap;
use serde_json::{json, Map};

use helpers::{
    compile_job, content_of, managers, produced, runtime_of, store_of, workspace, StubToolchain,
    CLEAN_LOG, EXECUTABLE, NOTHING,
};

const SANDBOX_ERROR_LOG: &str = "time:0.5\ntime-wall:1.5\ncg-mem:2048\nstatus:XX\nexitcode:1\n";
const ARCHIVE_NAME: &str = "sandbox-archive.tar.gz";

fn alone() -> Batch {
    Batch::new(&json!(["alone", ["", ""], "diff"])).expect("three parameters are a task")
}

fn assert_archived(store: &FsCache, sandboxes: &[PathBuf], digests: &DigestMap) {
    assert_eq!(sandboxes.len(), digests.len());
    for path in sandboxes {
        let key = path.to_string_lossy().into_owned();
        let digest = digests.get(&key).expect("the sandbox path has a digest");
        assert_eq!(&content_of(store, digest)[..2], &[0x1f, 0x8b]);
    }
}

#[test]
fn a_compilation_archive_is_keyed_by_its_sandbox_path() {
    let dir = workspace("archive-compile");
    let store = store_of(&dir);
    let runtime = runtime_of(&dir, "0", CLEAN_LOG, &produced(EXECUTABLE));

    let compiled = alone()
        .compile(
            &compile_job(managers()),
            &StubToolchain,
            &runtime,
            Box::new(store.clone()),
        )
        .expect("the compilation must run");

    assert!(compiled.success);
    assert_eq!(compiled.sandboxes.len(), 1);
    assert_archived(&store, &compiled.sandboxes, &compiled.sandbox_digests);
    assert!(compiled.sandboxes[0].is_dir());

    let mut body = Map::new();
    compiled.write_body(&mut body);
    assert_eq!(body["sandbox_digests"], json!(compiled.sandbox_digests));
    assert_eq!(body["sandboxes"], json!(compiled.sandboxes));
}

#[test]
fn a_failed_box_is_archived_before_it_is_kept() {
    let dir = workspace("archive-compile-failed");
    let store = store_of(&dir);
    let runtime = runtime_of(&dir, "0", SANDBOX_ERROR_LOG, NOTHING);

    let compiled = alone()
        .compile(
            &compile_job(managers()),
            &StubToolchain,
            &runtime,
            Box::new(store.clone()),
        )
        .expect("a failed box is a result, not a worker error");

    assert!(!compiled.success);
    assert_eq!(compiled.sandboxes.len(), 1);
    assert_archived(&store, &compiled.sandboxes, &compiled.sandbox_digests);
    assert!(compiled.sandboxes[0].is_dir());
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

    let refused = compile(
        &task,
        &compile_job(managers()),
        Some(&StubToolchain),
        &runtime,
        Box::new(store),
    );

    assert!(
        matches!(refused, Err(TaskError::Archive(ArchiveError::Store { .. }))),
        "{refused:?}"
    );
    assert!(dir.join("cms-sandbox-compile").is_dir());
}
