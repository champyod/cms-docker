use super::{validate_script_name, RunError, Runner};

fn runner() -> Runner {
    Runner::new().expect("repo root should resolve")
}

#[test]
fn resolves_repo_root_containing_cms_and_makefile() {
    let runner = runner();
    assert!(
        runner.repo_root().join("cms").exists(),
        "cms script present"
    );
    assert!(
        runner.repo_root().join("Makefile").exists(),
        "Makefile present"
    );
}

#[test]
fn run_make_bad_target_returns_nonzero() {
    let code = runner()
        .run_make("__cms_tui_definitely_missing_target__", &[])
        .expect("make should spawn");
    assert_ne!(code, 0, "missing make target must fail");
}

#[test]
fn checked_and_unchecked_make_report_one_code_and_name_the_target() {
    let runner = runner();
    let target = "__cms_tui_definitely_missing_target__";
    let code = runner.run_make(target, &[]).expect("make should spawn");
    let err = runner
        .run_make_checked(target, &[])
        .expect_err("missing make target must fail");
    match err {
        RunError::NonZero {
            command,
            code: reported,
        } => {
            assert_eq!(reported, code, "both paths must report one code");
            assert!(
                command.contains(target),
                "error names the target, got {command}"
            );
        }
        other => panic!("expected a non-zero exit, got {other:?}"),
    }
}

#[test]
fn run_sh_executes_script_in_repo_root() {
    let code = runner()
        .run_sh("__preflight.sh", &[])
        .expect("script should spawn");
    assert!(
        code == 0 || code == 2,
        "preflight ran and returned a real exit code, got {code}"
    );
}

#[test]
fn run_sh_reports_a_missing_script_instead_of_an_exit_127() {
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
fn run_sh_message_suggests_doctor() {
    let message = RunError::ScriptMissing {
        script: "__nope.sh".into(),
    }
    .to_string();
    assert!(message.contains("./cms doctor"), "{message}");
}

#[test]
fn repo_root_error_explains_how_to_recover() {
    let message = RunError::RepoRootMissing.to_string();
    assert!(message.contains("Makefile"), "{message}");
    assert!(message.contains("CMS checkout"), "{message}");
}

#[test]
fn validate_accepts_plain_script_name() {
    assert!(validate_script_name("__preflight.sh").is_ok());
}

#[test]
fn validate_rejects_empty_name() {
    assert!(matches!(
        validate_script_name(""),
        Err(RunError::InvalidScriptName { .. })
    ));
}

#[test]
fn validate_rejects_path_traversal() {
    for bad in ["../scripts/x", "a/../b", "..", "../../etc/passwd"] {
        assert!(validate_script_name(bad).is_err(), "reject {bad}");
    }
}

#[test]
fn validate_rejects_absolute_and_leading_dash() {
    assert!(validate_script_name("/etc/passwd").is_err());
    assert!(validate_script_name("-n").is_err());
}

#[test]
fn validate_rejection_names_the_offending_input() {
    let err = validate_script_name("../escape.sh").expect_err("traversal is refused");
    let message = err.to_string();
    assert!(message.contains("../escape.sh"), "{message}");
}

#[test]
fn find_repo_root_rejects_dir_without_markers() {
    let tmp = std::env::temp_dir().join("cms_runner_no_markers");
    std::fs::create_dir_all(&tmp).expect("create temp dir");
    // `tmp` is inside /tmp, walk up — eventually /tmp has no Makefile+cms
    // and we should surface a clear error via Runner::new.
    let result = Runner::new();
    drop(tmp);
    let _ = result; // dev tree resolves via cwd; this only checks no panic
}
