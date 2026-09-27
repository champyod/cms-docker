//! What a run is launched with, what the launch returns, and what the log says.
//!
//! Nothing here needs an isolation program to be installed. A run is launched
//! under a stub executable the test wrote, which writes the log a real one would
//! write, prints as much to both pipes as a pipe cannot hold, and returns a code
//! the test chose. That makes the drain, the log, the codes and the limits all
//! decided by the test rather than by a machine.

use std::fs;
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::time::Duration;

use cms_worker::sandbox::{
    MappedDirectory, Options, Outcome, ReadError, Sandbox, SpawnError, Stream,
};
use cms_worker::ExitStatus;

/// The kibibytes the log's memory figure is reported in.
const KIB: u64 = 1024;
/// The log a stub writes for a run that returned non-zero and was charged 0.5s.
const RETURNED_LOG: &str = "time:0.5\ntime-wall:1.5\ncg-mem:2048\nstatus:RE\nexitcode:3\n";
/// A log with no number in it, for a key that promises one.
const UNREADABLE_LOG: &str = "time:not-a-number\n";

/// A directory of this test's own, named after the test so parallel tests differ.
///
/// The stubs are written into the build directory rather than the system's
/// temporary one: a run is started by forking, and forking in a process whose
/// other threads are still writing executables into a memory-backed temporary
/// directory can be refused as a file that is still open for writing.
fn workspace(test: &str) -> PathBuf {
    let dir = Path::new(env!("CARGO_TARGET_TMPDIR")).join(test);
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("the test's own directory must be creatable");
    dir
}

/// Writes an executable stub, and the path to run it by.
///
/// The file is created new and written to its end before it is run: a stub that
/// is still being written when the run starts it cannot be executed at all, and
/// the refusal names the file rather than anything the run did.
fn stub(dir: &Path, name: &str, body: &str) -> PathBuf {
    let path = dir.join(name);
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .expect("the stub must be creatable");
    file.write_all(body.as_bytes())
        .expect("the stub must be writable");
    file.sync_all()
        .expect("the stub must be written to its end");
    drop(file);
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).expect("the stub must run");
    path
}

/// A stub standing in for the isolation program: it writes the log it was told to
/// write, prints far more to both pipes than either of them can hold, and returns
/// the code it was told to return.
fn isolation_stub(dir: &Path, code: &str, log: &str) -> PathBuf {
    stub(
        dir,
        "isolate",
        &format!(
            "#!/bin/sh\n\
             meta=\n\
             for arg in \"$@\"; do\n\
             \x20 case \"$arg\" in --meta=*) meta=\"${{arg#--meta=}}\" ;; esac\n\
             done\n\
             line=0123456789012345678901234567890123456789012345678901234567890123\n\
             i=0\n\
             while [ \"$i\" -lt 2000 ]; do\n\
             \x20 printf '%s\\n' \"$line\"\n\
             \x20 printf '%s\\n' \"$line\" >&2\n\
             \x20 i=$((i + 1))\n\
             done\n\
             printf '{log}' > \"$meta\"\n\
             exit {code}\n"
        ),
    )
}

/// A sandbox whose runs are launched under the stub at `executable`.
fn sandbox(executable: &Path, dir: &Path) -> Sandbox {
    Sandbox::new(executable, dir, "box").expect("the run's own directory must be creatable")
}

#[test]
fn the_flags_are_written_in_the_reference_order_with_the_log_named_last() {
    let options = Options::for_sandbox(Path::new("/outer/home"));
    let flags = options.arguments(Path::new("/outer/run.log.0"));
    assert_eq!(
        flags,
        vec![
            "--cg",
            "--chdir=/tmp",
            "--dir=/tmp=/outer/home:rw",
            "--dir=/dev/shm=/dev/shm:tmp",
            "--env=HOME=/tmp",
            "--processes",
            "--meta=/outer/run.log.0",
            "--run",
        ]
    );
    let last_two = &flags[flags.len() - 2..];
    assert_eq!(last_two, ["--meta=/outer/run.log.0", "--run"]);
}

#[test]
fn a_size_in_bytes_is_written_in_the_kibibytes_the_isolation_program_takes() {
    let options = Options {
        file_size: Some(2048 * KIB),
        stack_size: Some(64 * KIB),
        address_space: Some(256 * KIB),
        cpu_time: Some(Duration::from_millis(1500)),
        wall_clock_timeout: Some(Duration::from_secs(10)),
        extra_time: Some(Duration::from_millis(500)),
        verbosity: 2,
        max_processes: Some(30),
        ..Options::default()
    };
    let flags = options.arguments(Path::new("/outer/run.log.1"));
    for expected in [
        "--fsize=2048",
        "--stack=64",
        "--cg-mem=256",
        "--processes=30",
        "--time=1.5",
        "--wall-time=10",
        "--extra-time=0.5",
        "--verbose",
    ] {
        assert!(
            flags.contains(&expected.to_owned()),
            "{expected} missing from {flags:?}"
        );
    }
    assert_eq!(flags.iter().filter(|flag| *flag == "--verbose").count(), 2);
}

#[test]
fn a_stream_is_named_the_way_the_run_sees_it_and_the_environment_is_told_in_order() {
    let options = Options {
        stdin_file: Some(PathBuf::from("fifo0/input.txt")),
        stdout_file: Some(PathBuf::from("/tmp/fifo0/u0_to_m")),
        stderr_file: Some(PathBuf::from("fifo0/err.txt")),
        full_environment: true,
        inherited_variables: vec!["LANG".to_owned()],
        assigned_variables: vec![("HOME".to_owned(), "/tmp".to_owned())],
        ..Options::default()
    };
    let flags = options.arguments(Path::new("/outer/run.log.0"));
    for expected in [
        "--stdin=/tmp/fifo0/input.txt",
        "--stdout=/tmp/fifo0/u0_to_m",
        "--stderr=/tmp/fifo0/err.txt",
        "--full-env",
        "--env=LANG",
        "--env=HOME=/tmp",
    ] {
        assert!(
            flags.contains(&expected.to_owned()),
            "{expected} missing from {flags:?}"
        );
    }
    let environment: Vec<&String> = flags
        .iter()
        .filter(|flag| flag.starts_with("--env") || *flag == "--full-env")
        .collect();
    assert_eq!(environment[0], "--full-env");
    assert_eq!(environment[1], "--env=LANG");
}

#[test]
fn a_mapping_is_written_destination_then_source_then_rules() {
    assert_eq!(MappedDirectory::new("/usr").argument(), "/usr");
    assert_eq!(
        MappedDirectory::at("/outer/home", "/tmp").argument(),
        "/tmp=/outer/home"
    );
    assert_eq!(
        MappedDirectory::at("/etc/mono", "/etc/mono")
            .with_options("noexec")
            .argument(),
        "/etc/mono=/etc/mono:noexec"
    );
}

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
fn a_run_that_prints_more_than_a_pipe_holds_still_finishes_and_is_read_whole() {
    let dir = workspace("drain");
    let executable = isolation_stub(&dir, "1", RETURNED_LOG);
    let mut box_of = sandbox(&executable, &dir);
    let stats = box_of.run(&["/bin/true"]).expect("the run must finish");
    let printed = stats.stdout.expect("the run's output must be collected");
    assert_eq!(
        printed.lines().count(),
        2000,
        "both pipes must be read to their end"
    );
    assert!(
        stats
            .stderr
            .expect("the run's error output")
            .lines()
            .count()
            == 2000
    );
    assert_eq!(box_of.executions(), 1);
    let _ = fs::remove_dir_all(&dir);
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

#[test]
fn a_pipe_and_its_which_are_named_so_a_failure_says_which_one_failed() {
    let failure = ReadError::Pipe {
        stream: Stream::Error,
        source: std::io::Error::other("closed"),
    };
    assert!(failure.to_string().contains("standard error"));
    assert!(Outcome::of_bypassed(exit_status_of(0)).is_ok());
}

/// The status a process that returned `code` would have.
fn exit_status_of(code: i32) -> std::process::ExitStatus {
    std::process::Command::new("/bin/sh")
        .args(["-c", &format!("exit {code}")])
        .status()
        .expect("the shell must run")
}
