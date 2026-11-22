//! What a run may write, decided on a plain directory.
//!
//! No isolation program runs here and nothing needs privilege: the rules are
//! decided by resolving paths on this side and applied as permissions, so a test
//! reads the same answer a run would meet without a box, a chroot or a second user.

use std::fs;
use std::os::unix::fs::{symlink, PermissionsExt};
use std::path::{Path, PathBuf};

use cms_sandbox::Sandbox;

#[path = "sandbox_helpers.rs"]
mod helpers;

use helpers::{sandbox, workspace};

/// A sandbox whose runs are never launched, and the directory its home sits in.
fn boxed(test: &str) -> (PathBuf, Sandbox) {
    let dir = workspace(test);
    let sandbox = sandbox(Path::new("/nonexistent/isolate"), &dir);
    (dir, sandbox)
}

/// The permission bits of a path, which is the whole of what a run meets.
fn mode(path: &Path) -> u32 {
    fs::metadata(path)
        .expect("the path must exist")
        .permissions()
        .mode()
        & 0o7777
}

/// A file outside the home, holding a permission that no granted path may change.
fn outside_file(dir: &Path, name: &str) -> PathBuf {
    let path = dir.join(name);
    fs::write(&path, b"another solution's input").expect("the file must be writable");
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
        .expect("the file must be chmoddable");
    path
}

#[test]
fn an_inner_path_is_the_same_name_under_the_home() {
    let (_, sandbox) = boxed("relative-path");
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
    let (_, sandbox) = boxed("whole-home");
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

#[test]
fn a_path_inside_the_home_is_granted() {
    let (_, sandbox) = boxed("granted");
    let answer = sandbox.relative_path("answer.txt");
    fs::write(&answer, b"42").expect("the file must be writable");
    fs::set_permissions(&answer, fs::Permissions::from_mode(0o600))
        .expect("the file must be chmoddable");

    let inside = sandbox
        .home()
        .canonicalize()
        .expect("the home must resolve");
    assert_eq!(
        sandbox.writable_paths(&["answer.txt"]),
        vec![inside.join("answer.txt")]
    );
    sandbox
        .allow_writing_only(&["answer.txt"])
        .expect("the path is inside the home");
    assert_eq!(mode(&answer), 0o722);
    assert_eq!(mode(sandbox.home()), 0o755);
}

#[test]
fn a_path_that_does_not_exist_yet_is_created_empty() {
    let (_, sandbox) = boxed("created");
    let stdout = sandbox.relative_path("stdout.txt");
    assert!(!stdout.exists());

    sandbox
        .allow_writing_only(&["stdout.txt"])
        .expect("a missing path inside the home is created");
    assert_eq!(
        fs::metadata(&stdout).expect("the file must exist").len(),
        0,
        "the created file must be empty"
    );
    assert_eq!(mode(&stdout), 0o722);
}

#[test]
fn a_path_that_climbs_out_of_the_home_is_not_granted() {
    let (dir, sandbox) = boxed("traversal");
    let escape = outside_file(&dir, "escape.txt");
    let missing = dir.join("created-outside.txt");

    assert!(sandbox.writable_paths(&["../../escape.txt"]).is_empty());
    assert!(sandbox
        .writable_paths(&["../../created-outside.txt"])
        .is_empty());
    sandbox
        .allow_writing_only(&["../../escape.txt", "../../created-outside.txt"])
        .expect("a path outside the home is ignored, not an error");

    assert_eq!(mode(&escape), 0o600, "a file outside the home was chmodded");
    assert!(
        !missing.exists(),
        "a path outside the home was created before it was resolved"
    );
    assert_eq!(mode(sandbox.home()), 0o755);
}

#[test]
fn an_absolute_path_outside_the_home_is_not_granted() {
    let (dir, sandbox) = boxed("absolute");
    let escape = outside_file(&dir, "escape.txt");
    let escape = escape.to_str().expect("the test's own path is text");

    assert!(sandbox.writable_paths(&[escape]).is_empty());
    sandbox
        .allow_writing_only(&[escape])
        .expect("an absolute path outside the home is ignored");

    assert_eq!(
        mode(Path::new(escape)),
        0o600,
        "an outside path was chmodded"
    );
    assert_eq!(mode(sandbox.home()), 0o755);
}

#[test]
fn a_symlink_inside_the_home_that_points_out_is_not_granted() {
    let (dir, sandbox) = boxed("symlink-out");
    let target = outside_file(&dir, "target.txt");
    let link = sandbox.relative_path("link.txt");
    symlink(&target, &link).expect("the link must be creatable");

    assert!(sandbox.writable_paths(&["link.txt"]).is_empty());
    sandbox
        .allow_writing_only(&["link.txt"])
        .expect("a link out of the home is ignored");

    assert_eq!(
        mode(&target),
        0o600,
        "following the link chmodded the file it points at"
    );
    assert_eq!(
        fs::read_link(&link).expect("the link must still be a link"),
        target
    );
}

#[test]
fn one_bad_path_stays_closed_while_the_good_one_opens() {
    let (dir, sandbox) = boxed("mixed");
    let escape = outside_file(&dir, "escape.txt");
    let good = sandbox.relative_path("good.txt");
    let other = sandbox.relative_path("other.txt");
    fs::write(&good, b"").expect("the file must be writable");
    fs::write(&other, b"").expect("the file must be writable");
    fs::set_permissions(&other, fs::Permissions::from_mode(0o644))
        .expect("the file must be chmoddable");

    sandbox
        .allow_writing_only(&["good.txt", "../../escape.txt"])
        .expect("the good path must still be granted");

    assert_eq!(mode(&good), 0o722, "the named path must be open");
    assert_eq!(mode(&other), 0o755, "an unnamed neighbour must be closed");
    assert_eq!(mode(&escape), 0o600, "the refused path must stay untouched");
    assert_eq!(mode(sandbox.home()), 0o755);
}
