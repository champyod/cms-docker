#[path = "tasktypes_archive_assertions.rs"]
mod assertions;
#[path = "tasktypes_communication_helpers.rs"]
mod support;

use std::fs;

use cms_grading::execute::evaluate;
use cms_grading::tasktypes::TaskType;
use serde_json::{json, Map};

use assertions::{assert_archived, assert_body_pair};

const PROCESSES: usize = 2;

#[test]
fn communication_archives_every_box_under_its_own_path() {
    for keep in [false, true] {
        let label = if keep {
            "archive-communication-kept"
        } else {
            "archive-communication-removed"
        };
        let dir = support::workspace(label);
        let store = support::store_of(&dir);
        let runtime = support::runtime_of(&dir, "0.5", support::THREE).with_keep_sandbox(keep);
        let task = TaskType::of("Communication", &json!([PROCESSES, "stub", "fifo_io"]))
            .expect("a Communication task");
        let mut job = support::job();
        job.archive_sandbox = true;

        let evaluated = evaluate(
            &task,
            &job,
            Some(&support::StubToolchain),
            &runtime,
            Box::new(store.clone()),
        )
        .expect("the manager and processes must run");

        assert!(evaluated.success);
        assert_eq!(evaluated.sandboxes.len(), support::THREE);
        assert_archived(&store, &evaluated.sandboxes, &evaluated.sandbox_digests);
        assert!(evaluated.sandboxes.iter().all(|path| path.is_dir() == keep));
        let retained_pipes = fs::read_dir(&dir)
            .expect("the workspace is readable")
            .map(|entry| entry.expect("a workspace entry is readable"))
            .filter(|entry| entry.file_name().to_string_lossy().starts_with("cms-pipe-"))
            .count();
        assert_eq!(retained_pipes, if keep { PROCESSES } else { 0 });
        let mut body = Map::new();
        evaluated.write_body(&mut body);
        assert_body_pair(&body, &evaluated.sandboxes, &evaluated.sandbox_digests);
    }
}
