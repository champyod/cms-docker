//! Running a dataset's checker: the files it is handed, the limits it is held to, and
//! the difference between a check that could not be made and a verdict of zero.
//!
//! The isolation program here is a stub this test writes: it records the arguments it
//! was given, prints what the test chose, writes the log a real one would write and
//! returns zero. No run is timed, nothing sleeps, and no isolation program has to be
//! installed for any of it.

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::time::Duration;

use cms_worker::sandbox::Sandbox;
use cms_worker::stage::{Cache, CacheHandle, FileDigest, FsCache, Stage, StageError};
use cms_worker::steps::{checker_step, Check, StepError, TrustedLimits, Verdict};

/// The digests the store below holds, and the content each names.
const INPUT: &str = "6f81d0ddbb5b80e2e7e0f1e2c9b2a02ba1ba1d5e";
const CORRECT: &str = "0d7f183e5c9a4f7ad6d5d2b8a8a1b3bfb0e0a1c2";
const CHECKER: &str = "8a6e2f4b1c3d5e7f90123456789abcdef0123456";
/// A digest no store below holds.
const ABSENT: &str = "1111111111111111111111111111111111111111";
/// The log a run that measured itself and ended cleanly writes.
const CLEAN_LOG: &str = "time:0.5\ntime-wall:1.5\ncg-mem:2048\n";
/// The log a run stopped by its own CPU limit writes.
const STOPPED_LOG: &str = "time:5\ntime-wall:5\ncg-mem:2048\nstatus:TO\nexitcode:0\n";
/// What a checker that answered with a score printed, and what one that answered with
/// no score printed.
const SCORED: &str = "printf '0.5\\n'; printf 'Output is partially correct\\n' >&2";
const UNSCORED: &str = "printf 'not a number\\n'";
/// The name the submission's answer has in the box.
const OUTPUT_FILENAME: &str = "user_output.txt";

fn workspace(test: &str) -> PathBuf {
    let dir = Path::new(env!("CARGO_TARGET_TMPDIR")).join(test);
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("the test's own directory must be creatable");
    dir
}

/// A box and a stage over one directory, with the three files a checker reads already
/// in the store, and a stub isolation program printing `said` and writing `log`.
fn boxed(dir: &Path, said: &str, log: &str) -> (Sandbox, Stage) {
    let program = dir.join("isolate");
    let script = format!(
        "#!/bin/sh\n\
         meta=\nhome=\n\
         for arg in \"$@\"; do\n\
         \x20 case \"$arg\" in\n\
         \x20\x20--meta=*) meta=\"${{arg#--meta=}}\" ;;\n\
         \x20\x20--dir=/tmp=*) home=\"${{arg#--dir=/tmp=}}\"; home=\"${{home%%:*}}\" ;;\n\
         \x20 esac\n\
         done\n\
         printf '%s\\n' \"$@\" > \"$home/flags.txt\"\n\
         {said}\n\
         printf '{log}' > \"$meta\"\n\
         exit 0\n"
    );
    fs::write(&program, script).expect("the stub must be writable");
    fs::set_permissions(&program, fs::Permissions::from_mode(0o755)).expect("the stub must run");

    let store = FsCache::at(dir.join("store")).expect("a store directory");
    for (digest, content) in [
        (INPUT, b"the input".as_slice()),
        (CORRECT, b"the correct answer"),
        (CHECKER, b"the checker"),
    ] {
        let digest = FileDigest::from_str(digest).expect("a digest the domain admits");
        store.put_file(&digest, content).expect("content stored");
    }
    let sandbox = Sandbox::new(&program, dir, "check").expect("a box");
    let files = Stage::at(sandbox.home(), Box::new(store)).expect("a stage");
    (sandbox, files)
}

fn handle(digest: &str) -> CacheHandle {
    CacheHandle::new(FileDigest::from_str(digest).expect("a digest the domain admits"))
}

/// The check a test asks for, over the files the store above holds.
fn check(checker: Option<&str>) -> Check<'static> {
    Check {
        checker: checker.map(handle),
        input: handle(INPUT),
        correct_output: handle(CORRECT),
        output_filename: OUTPUT_FILENAME,
        extra_args: &[],
        limits: TrustedLimits::new(4, Duration::from_secs(20), 64 * 1024 * 1024),
    }
}

fn staged(box_of: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(box_of.join("home"))
        .expect("a box to have a directory")
        .map(|entry| {
            entry
                .expect("a staged file")
                .file_name()
                .to_string_lossy()
                .into_owned()
        })
        .collect();
    names.sort();
    names
}

#[test]
fn a_checker_runs_over_the_three_files_it_is_handed_and_the_answer() {
    let dir = workspace("trusted-runs");
    let (mut sandbox, files) = boxed(&dir, SCORED, CLEAN_LOG);
    files
        .write(OUTPUT_FILENAME, b"the answer", false)
        .expect("the answer is in the box");

    let said = checker_step(&mut sandbox, &files, &check(Some(CHECKER)))
        .expect("the checker must run")
        .expect("a verdict");

    assert_eq!(
        said,
        Verdict {
            outcome: 0.5,
            text: vec!["Output is partially correct".to_owned()],
            admin_text: None,
        }
    );
    assert_eq!(
        staged(sandbox.outer()),
        vec![
            "checker",
            "correct_output.txt",
            "flags.txt",
            "input.txt",
            "user_output.txt",
        ],
        "the checker is copied in, with the two files it reads and the answer"
    );
    let flags =
        fs::read_to_string(sandbox.home().join("flags.txt")).expect("the stub recorded them");
    let command = flags
        .split_once("--\n")
        .expect("the command follows the option end")
        .1;
    assert_eq!(
        command,
        "./checker\ninput.txt\ncorrect_output.txt\nuser_output.txt\n"
    );
    for flag in ["--full-env", "--time=20", "--wall-time=41", "--processes=4"] {
        assert!(flags.contains(flag), "{flag} must be among {flags}");
    }
}

#[test]
fn a_file_the_box_already_holds_is_a_check_that_cannot_be_made() {
    let dir = workspace("trusted-present");
    let (mut sandbox, files) = boxed(&dir, SCORED, CLEAN_LOG);
    files
        .write("input.txt", b"staged by mistake", false)
        .expect("the file a task type should never have staged");

    let said = checker_step(&mut sandbox, &files, &check(Some(CHECKER)))
        .expect("nothing the worker could not do");

    assert!(said.is_none(), "a box already holding a file is no verdict");
    assert!(
        !sandbox.home().join("flags.txt").exists(),
        "the guard is asked before anything is launched"
    );
    assert_eq!(
        fs::read(sandbox.home().join("input.txt")).expect("the file is still there"),
        b"staged by mistake",
        "and the file that was there is not overwritten"
    );
}

#[test]
fn a_dataset_holding_no_checker_is_a_check_that_cannot_be_made() {
    let dir = workspace("trusted-none");
    let (mut sandbox, files) = boxed(&dir, SCORED, CLEAN_LOG);
    files
        .write(OUTPUT_FILENAME, b"the answer", false)
        .expect("the answer is in the box");

    let said =
        checker_step(&mut sandbox, &files, &check(None)).expect("nothing the worker could not do");

    assert!(said.is_none(), "there is no check without a checker");
    assert!(
        !sandbox.home().join("flags.txt").exists(),
        "and nothing is launched"
    );
}

#[test]
fn a_checker_that_reported_no_score_or_was_stopped_is_no_verdict() {
    for (label, said, log) in [
        ("trusted-unscored", UNSCORED, CLEAN_LOG),
        ("trusted-stopped", SCORED, STOPPED_LOG),
    ] {
        let dir = workspace(label);
        let (mut sandbox, files) = boxed(&dir, said, log);
        files
            .write(OUTPUT_FILENAME, b"the answer", false)
            .expect("the answer is in the box");

        let decided = checker_step(&mut sandbox, &files, &check(Some(CHECKER)))
            .expect("the box could carry the run");

        assert!(
            decided.is_none(),
            "{label} is not a verdict about an answer"
        );
    }
}

#[test]
fn a_checker_no_store_holds_is_the_workers_own_failure() {
    let dir = workspace("trusted-unstored");
    let (mut sandbox, files) = boxed(&dir, SCORED, CLEAN_LOG);

    let refused = checker_step(&mut sandbox, &files, &check(Some(ABSENT)));

    assert!(
        matches!(refused, Err(StepError::Stage(StageError::NotStored { .. }))),
        "a checker that cannot be staged is a worker failure, not a verdict: {refused:?}"
    );
}
