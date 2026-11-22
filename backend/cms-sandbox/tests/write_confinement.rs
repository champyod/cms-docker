//! What a run may write, decided on a plain directory.
//!
//! No isolation program runs here and nothing needs privilege: the rules are
//! decided by resolving paths on this side and applied as permissions, so a test
//! reads the same answer a run would meet without a box, a chroot or a second user.

use std::path::{Path, PathBuf};

use cms_sandbox::Sandbox;

#[path = "sandbox_helpers.rs"]
mod helpers;

use helpers::{sandbox, workspace};

/// A sandbox whose runs are never launched: its home is all these tests need.
fn boxed(test: &str) -> Sandbox {
    sandbox(Path::new("/nonexistent/isolate"), &workspace(test))
}

#[test]
fn an_inner_path_is_the_same_name_under_the_home() {
    let sandbox = boxed("relative-path");
    assert_eq!(
        sandbox.relative_path("logs/run.txt"),
        sandbox.home().join("logs/run.txt")
    );
    assert_eq!(
        sandbox.relative_path("/etc/passwd"),
        PathBuf::from("/etc/passwd")
    );
}
