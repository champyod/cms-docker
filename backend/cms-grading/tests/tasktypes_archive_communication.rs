#[path = "tasktypes_archive_assertions.rs"]
mod assertions;
#[path = "tasktypes_communication_helpers.rs"]
mod support;

use cms_grading::execute::evaluate;
use cms_grading::tasktypes::TaskType;
use serde_json::{json, Map};

use assertions::{assert_archived, assert_body_pair};

#[test]
fn communication_archives_every_box_under_its_own_path() {
    let dir = support::workspace("archive-communication");
    let store = support::store_of(&dir);
    let runtime = support::runtime_of(&dir, "0.5", support::THREE);
    let task = TaskType::of("Communication", &json!([2, "stub", "fifo_io"]))
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
    assert!(evaluated.sandboxes.iter().all(|path| !path.exists()));
    let mut body = Map::new();
    evaluated.write_body(&mut body);
    assert_body_pair(&body, &evaluated.sandboxes, &evaluated.sandbox_digests);
}
