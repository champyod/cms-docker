//! Both pipes read to their end, and which of them a failure names.
//!
//! A run that writes more to a pipe than the pipe can hold is only finished when
//! both ends are drained, so the stub behind these tests prints two thousand
//! lines to each and the run is held until both are read whole.

use std::fs;

use cms_worker::sandbox::{Outcome, ReadError, Stream};

#[path = "sandbox_helpers.rs"]
mod helpers;

use helpers::{exit_status_of, isolation_stub, sandbox, workspace, RETURNED_LOG};

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
fn a_pipe_and_its_which_are_named_so_a_failure_says_which_one_failed() {
    let failure = ReadError::Pipe {
        stream: Stream::Error,
        source: std::io::Error::other("closed"),
    };
    assert!(failure.to_string().contains("standard error"));
    assert!(Outcome::of_bypassed(exit_status_of(0)).is_ok());
}
