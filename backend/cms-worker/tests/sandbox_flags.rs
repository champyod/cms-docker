//! The arguments a run is launched with, in the order the isolation program takes
//! them.
//!
//! Nothing is launched here. The options are rendered into flags and compared
//! with the wire form, so a change to what is written is caught before any
//! program runs and leaves no directory behind.

use std::path::{Path, PathBuf};
use std::time::Duration;

use cms_worker::sandbox::{MappedDirectory, Options};

#[path = "sandbox_helpers.rs"]
mod helpers;

use helpers::KIB;

#[test]
fn the_flags_are_written_in_the_reference_order_with_the_log_named_last() {
    let options = Options::for_sandbox(Path::new("/outer/home"));
    let flags = options.arguments(Path::new("/outer/run.log.0"));
    assert_eq!(
        flags,
        vec![
            "--cg",
            "--box-id=0",
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
fn a_run_is_told_the_box_it_is_charged_to() {
    let options = Options {
        box_id: 42,
        ..Options::default()
    };
    let flags = options.arguments(Path::new("/outer/run.log.0"));
    assert_eq!(flags[1], "--box-id=42");
    assert_eq!(
        flags.iter().filter(|flag| *flag == "--box-id=42").count(),
        1
    );
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
fn a_displayed_line_quotes_only_the_words_a_shell_would_take_apart() {
    let options = Options::for_sandbox(Path::new("/outer/home"));
    let line = options.display(
        Path::new("/outer/run.log.0"),
        &["/bin/sh", "-c", "echo a b"],
    );
    assert!(line.ends_with("-- /bin/sh -c 'echo a b'"), "{line}");

    let quoted = options.display(
        Path::new("/outer/run.log.0"),
        &["/bin/sh", "-c", "echo 'a' && echo b"],
    );
    assert!(
        quoted.ends_with(r"-- /bin/sh -c 'echo '\''a'\'' && echo b'"),
        "{quoted}"
    );

    let spoken = options.display(Path::new("/outer/run.log.0"), &["/bin/echo"]);
    assert!(spoken.ends_with("-- /bin/echo"), "{spoken}");
}
