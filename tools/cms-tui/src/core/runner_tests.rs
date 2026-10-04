//! Unit tests for the runner's pure surface: the script-name guard that keeps
//! `scripts/<name>` from escaping its directory, repo-root detection, the
//! exit-code mapping that decides whether a step counts as failed, and the
//! spawn paths that report a missing script or a failing make target.

use super::{exit_code, validate_script_name, RunError, Runner};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn scratch_dir(label: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("cms_runner_{label}_{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("create scratch dir");
    dir
}

/// Builds a fake repo root: a `Makefile` plus the `cms` entry that mark it.
fn mark_repo_root(dir: &Path) {
    fs::write(dir.join("Makefile"), "help:\n\t@echo ok\n").expect("write Makefile");
    fs::write(dir.join("cms"), "#!/usr/bin/env bash\n").expect("write cms entry");
}

fn status_of(code: i32) -> std::process::ExitStatus {
    Command::new("sh")
        .arg("-c")
        .arg(format!("exit {code}"))
        .status()
        .expect("spawn sh")
}

fn runner() -> Runner {
    Runner::new().expect("repo root should resolve")
}

const MISSING_TARGET: &str = "__cms_tui_definitely_missing_target__";

#[test]
fn accepts_a_plain_script_name() {
    assert!(validate_script_name("__config_sync.sh").is_ok());
}

#[test]
fn rejects_names_that_could_escape_the_scripts_directory() {
    // Each case fails for a different reason: an empty name has no script, `..`
    // walks up, `/` is a subpath, and a leading `-` would be read as a bash option.
    for name in [
        "",
        "../etc/passwd",
        "nested/evil.sh",
        "--flag",
        "/etc/passwd",
        "-n",
    ] {
        let outcome = validate_script_name(name);
        assert!(
            matches!(outcome, Err(RunError::InvalidScriptName { .. })),
            "expected {name:?} to be refused, got {outcome:?}"
        );
    }
}

#[test]
fn the_refusal_names_the_input_and_the_rule() {
    let Err(RunError::InvalidScriptName { name, rule }) = validate_script_name("a/b") else {
        panic!("expected a refusal for a nested name");
    };
    assert_eq!(name, "a/b", "the message must name what was refused");
    assert!(
        rule.contains("scripts/") || rule.contains('/'),
        "the message must state the rule, got {rule:?}"
    );
}

#[test]
fn finds_the_repo_root_from_a_nested_directory() {
    let root = scratch_dir("root");
    mark_repo_root(&root);
    let nested = root.join("tools/cms-tui/src");
    fs::create_dir_all(&nested).expect("create nested dir");
    assert_eq!(
        Runner::find_repo_root(&nested),
        Some(root.clone()),
        "walking up should stop at the directory holding Makefile and cms"
    );
}

#[test]
fn has_no_repo_root_when_the_markers_are_absent() {
    // A directory with only one of the two markers must not be accepted, or every
    // spawned command would run somewhere unexpected.
    let root = scratch_dir("nomarkers");
    fs::write(root.join("Makefile"), "help:\n").expect("write Makefile");
    assert_eq!(Runner::find_repo_root(&root), None);
}

#[test]
fn resolves_the_real_repo_root_with_cms_and_makefile() {
    let root = runner().repo_root().to_path_buf();
    assert!(root.join("cms").exists(), "cms script present");
    assert!(root.join("Makefile").exists(), "Makefile present");
}

#[test]
fn maps_a_child_exit_code_through_unchanged() {
    assert_eq!(exit_code(status_of(0)), 0);
    assert_eq!(exit_code(status_of(3)), 3);
}

#[cfg(unix)]
#[test]
fn a_signalled_child_is_reported_as_failed() {
    use std::os::unix::process::ExitStatusExt;
    let killed = std::process::ExitStatus::from_raw(0x8b);
    assert_eq!(exit_code(killed), -1, "a signal must not look like success");
}

#[test]
fn run_sh_executes_a_script_in_the_repo_root() {
    let code = runner()
        .run_sh("__preflight.sh", &[])
        .expect("script should spawn");
    assert!(
        code == 0 || code == 2,
        "preflight ran and returned a real exit code, got {code}"
    );
}

#[test]
fn run_sh_refuses_a_missing_script_before_spawning_bash() {
    let err = runner()
        .run_sh("__cms_tui_definitely_missing_script__.sh", &[])
        .expect_err("a missing script must be refused before spawning bash");
    match err {
        RunError::ScriptMissing { script } => {
            assert!(
                script.ends_with(".sh"),
                "the message names the script, got {script}"
            );
        }
        other => panic!("expected a missing script, got {other:?}"),
    }
}

#[test]
fn a_missing_script_points_at_doctor() {
    let message = RunError::ScriptMissing {
        script: "__nope.sh".into(),
    }
    .to_string();
    assert!(message.contains("./cms doctor"), "{message}");
}

#[test]
fn a_missing_repo_root_explains_how_to_recover() {
    let message = RunError::RepoRootMissing.to_string();
    assert!(message.contains("Makefile"), "{message}");
    assert!(message.contains("CMS checkout"), "{message}");
}

#[test]
fn run_make_reports_a_failing_target_as_non_zero() {
    let code = runner()
        .run_make(MISSING_TARGET, &[])
        .expect("make should spawn");
    assert_ne!(code, 0, "missing make target must fail");
}

#[test]
fn checked_and_unchecked_make_agree_on_the_code_and_name_the_target() {
    // Two paths, one truth: the checked call must not invent a different code,
    // and its message must say which target failed.
    let runner = runner();
    let code = runner
        .run_make(MISSING_TARGET, &[])
        .expect("make should spawn");
    let err = runner
        .run_make_checked(MISSING_TARGET, &[])
        .expect_err("missing make target must fail");
    match err {
        RunError::NonZero {
            command,
            code: reported,
        } => {
            assert_eq!(reported, code, "both paths must report one code");
            assert!(
                command.contains(MISSING_TARGET),
                "error names the target, got {command}"
            );
        }
        other => panic!("expected a non-zero exit, got {other:?}"),
    }
}
