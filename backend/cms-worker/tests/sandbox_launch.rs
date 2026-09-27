//! What a run is launched with, what the launch returns, and what the log says.
//!
//! Every run here is launched under a stub that writes the log a real one would
//! write and returns a code the test chose, so the codes, the log, the refusals
//! and the commands allowed to run beside the sandbox are all decided by the
//! test rather than by a machine.

use std::fs;

use cms_worker::sandbox::{Outcome, Sandbox, SpawnError};
use cms_worker::ExitStatus;

#[path = "sandbox_helpers.rs"]
mod helpers;

use helpers::{
    isolation_stub, isolation_stub_recording, sandbox, stub, workspace, KIB, RETURNED_LOG,
    UNREADABLE_LOG,
};

#[test]
fn only_the_four_commands_run_beside_the_isolation_program() {
    for command in ["/bin/cp", "/bin/mv", "/usr/bin/zip", "/usr/bin/unzip"] {
        assert!(
            Sandbox::is_secure_command(&[command, "a", "b"]),
            "{command}"
        );
    }
    assert!(!Sandbox::is_secure_command(&["/bin/sh", "-c", "cp a b"]));
    assert!(!Sandbox::is_secure_command(&["/usr/bin/cp"]));
    assert!(!Sandbox::is_secure_command(&[]));
}

#[test]
fn the_two_codes_the_isolation_program_documents_are_both_a_working_run() {
    assert_eq!(Outcome::of(0), Ok(Outcome::RunFinished));
    assert_eq!(Outcome::of(1), Ok(Outcome::RunEnded));
    assert!(Outcome::of(2).is_err());
    assert!(Outcome::of(-1).is_err());
}

#[test]
fn a_code_beside_the_sandbox_is_the_whole_of_the_answer_and_zero_is_the_only_one() {
    let finished = std::process::Command::new("/bin/true")
        .status()
        .expect("true must run");
    assert_eq!(Outcome::of_bypassed(finished), Ok(Outcome::RunFinished));
    let failed = std::process::Command::new("/bin/false")
        .status()
        .expect("false must run");
    assert!(Outcome::of_bypassed(failed).is_err());
    assert!(
        Outcome::of_sandbox(failed).is_ok(),
        "code 1 is a run that ended"
    );
}

#[test]
fn the_log_a_run_left_is_read_into_the_figures_a_report_shows() {
    let dir = workspace("log");
    let executable = isolation_stub(&dir, "1", RETURNED_LOG);
    let mut box_of = sandbox(&executable, &dir);
    let stats = box_of.run(&["/bin/true"]).expect("the run must finish");
    assert_eq!(stats.cpu_time, Some(0.5));
    assert_eq!(stats.wall_time, Some(1.5));
    assert_eq!(stats.memory_bytes, Some(2048 * KIB));
    assert_eq!(stats.exit_status, ExitStatus::NonzeroReturn);
    assert_eq!(stats.signal, None);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn each_run_is_logged_under_its_own_number_and_the_next_is_a_separate_run() {
    let dir = workspace("numbers");
    let executable = isolation_stub(&dir, "0", RETURNED_LOG);
    let mut box_of = sandbox(&executable, &dir);
    box_of
        .run(&["/bin/true"])
        .expect("the first run must finish");
    box_of
        .run(&["/bin/true"])
        .expect("the second run must finish");
    assert_eq!(box_of.executions(), 2);
    for number in 0..2 {
        let log = box_of.outer().join(format!("run.log.{number}"));
        assert!(log.is_file(), "run {number} must have a log of its own");
    }
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn a_command_beside_the_sandbox_is_run_in_the_runs_own_directory_with_no_output() {
    let dir = workspace("bypass");
    let executable = isolation_stub(&dir, "0", RETURNED_LOG);
    let mut box_of = sandbox(&executable, &dir);
    let source = box_of.home().join("input.txt");
    fs::write(&source, "contents").expect("the run's input must be writable");
    let source = source.display().to_string();
    let target = box_of.home().join("copied.txt").display().to_string();
    let stats = box_of
        .run(&["/bin/cp", &source, &target])
        .expect("the command must run beside the sandbox");
    assert!(
        box_of.home().join("copied.txt").is_file(),
        "it must write in the run's own directory"
    );
    assert_eq!(
        stats.cpu_time,
        Some(0.0),
        "a command beside the sandbox measured nothing"
    );
    assert_eq!(stats.exit_status, ExitStatus::Ok);
    assert_eq!(
        stats.stdout.as_deref(),
        Some(""),
        "its output is not forwarded"
    );
    assert!(!box_of
        .outer()
        .join("run.log.0")
        .to_string_lossy()
        .contains("status"));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn a_command_beside_the_sandbox_that_fails_is_a_box_that_was_never_set_up() {
    let dir = workspace("bypass-failed");
    let executable = isolation_stub(&dir, "0", RETURNED_LOG);
    let mut box_of = sandbox(&executable, &dir);
    let missing = box_of.home().join("absent.txt");
    let absent = missing.display().to_string();
    let absent_copy = box_of.home().join("also-absent.txt").display().to_string();
    let outcome = box_of.run(&["/bin/cp", &absent, &absent_copy]);
    assert!(
        matches!(outcome, Err(SpawnError::Exit { code: 1, .. })),
        "a command that failed must say so, not measure a run: {outcome:?}"
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn a_code_the_isolation_program_does_not_document_is_refused_before_its_log_is_read() {
    let dir = workspace("unknown-code");
    let executable = isolation_stub(&dir, "7", RETURNED_LOG);
    let mut box_of = sandbox(&executable, &dir);
    match box_of.run(&["/bin/true"]) {
        Err(SpawnError::Exit { code, .. }) => assert_eq!(code, 7),
        other => panic!("an undocumented code must be refused, not read: {other:?}"),
    }
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn a_run_that_wrote_no_log_measured_nothing_and_says_so() {
    let dir = workspace("no-log");
    let executable = stub(&dir, "isolate", "#!/bin/sh\nexit 0\n");
    let mut box_of = sandbox(&executable, &dir);
    match box_of.run(&["/bin/true"]) {
        Err(SpawnError::NoMetaFile { .. }) => {}
        other => panic!("a run that wrote no log must say so: {other:?}"),
    }
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn a_log_holding_a_number_it_cannot_be_read_as_is_refused() {
    let dir = workspace("unreadable");
    let executable = isolation_stub(&dir, "0", UNREADABLE_LOG);
    let mut box_of = sandbox(&executable, &dir);
    match box_of.run(&["/bin/true"]) {
        Err(SpawnError::Measure(_)) => {}
        other => panic!("a number that cannot be read must be refused: {other:?}"),
    }
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn a_run_is_started_with_exactly_the_words_the_options_render() {
    let dir = workspace("argv");
    let record = dir.join("argv.txt");
    let executable = isolation_stub_recording(&dir, "1", RETURNED_LOG, &record);
    let mut box_of = sandbox(&executable, &dir);
    let command = ["/bin/sh", "-c", "echo a b"];
    box_of.run(&command).expect("the run must finish");

    let launched: Vec<String> = fs::read_to_string(&record)
        .expect("the stub must have written down its arguments")
        .lines()
        .map(str::to_owned)
        .collect();
    let rendered = box_of
        .options()
        .invocation(&box_of.outer().join("run.log.0"), &command);
    assert_eq!(
        launched, rendered,
        "a run must be started with the arguments it was rendered from, and no other"
    );
    assert_eq!(
        box_of.executable(),
        executable,
        "the program those arguments are handed to is the one the box was built with"
    );
    assert_eq!(
        &launched[launched.len() - 5..],
        ["--run", "--", "/bin/sh", "-c", "echo a b"],
        "the flags end where the run's own words begin, one word per argument"
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn a_command_with_nothing_in_it_and_a_program_that_is_not_there_are_both_refused() {
    let dir = workspace("refused");
    let executable = dir.join("no-such-program");
    let mut box_of = sandbox(&executable, &dir);
    match box_of.run(&[]) {
        Err(SpawnError::EmptyCommand) => {}
        other => panic!("a command with nothing in it must be refused: {other:?}"),
    }
    match box_of.run(&[""]) {
        Err(SpawnError::NamelessCommand) => {}
        other => panic!("a command with no program in it must be refused: {other:?}"),
    }
    match box_of.run(&["/bin/true"]) {
        Err(SpawnError::Unlaunchable { .. }) => {}
        other => panic!("a program that is not there must be refused: {other:?}"),
    }
    let _ = fs::remove_dir_all(&dir);
}
