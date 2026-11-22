//! What a run may write, decided on a plain directory.
//!
//! No isolation program runs here and nothing needs privilege: the rules are
//! decided by resolving paths on this side and applied as permissions, so a test
//! reads the same answer a run would meet without a box, a chroot or a second user.

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use cms_sandbox::Sandbox;

#[path = "sandbox_helpers.rs"]
mod helpers;

use helpers::{sandbox, workspace};

/// A sandbox whose runs are never launched: its home is all these tests need.
fn boxed(test: &str) -> Sandbox {
    sandbox(Path::new("/nonexistent/isolate"), &workspace(test))
}

/// The permission bits of a path, which is the whole of what a run meets.
fn mode(path: &Path) -> u32 {
    fs::metadata(path)
        .expect("the path must exist")
        .permissions()
        .mode()
        & 0o7777
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

#[test]
fn the_whole_home_opens_and_closes_again() {
    let sandbox = boxed("whole-home");
    let answer = sandbox.relative_path("answer.txt");
    fs::write(&answer, b"42").expect("the file must be writable");
    fs::set_permissions(&answer, fs::Permissions::from_mode(0o600))
        .expect("the file must be chmoddable");

    sandbox
        .allow_writing_all()
        .expect("the home must open to writes");
    assert_eq!(mode(sandbox.home()), 0o777);
    assert_eq!(mode(&answer), 0o777);

    sandbox
        .allow_writing_none()
        .expect("the home must close to writes");
    assert_eq!(mode(sandbox.home()), 0o755);
    assert_eq!(mode(&answer), 0o755);
}
