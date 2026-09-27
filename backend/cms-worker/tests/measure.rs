//! The log a test writes, the status it means, and the sentence it is shown with.
//!
//! Every fixture is the text isolate would have written, so every answer is
//! decided: nothing is launched, nothing sleeps, and nothing is measured.

use cms_worker::{ExecutionLog, ExitStatus, MeasureError};

/// Kibibytes in the byte count a memory figure is reported as.
const KIB: u64 = 1024;

/// A log a test wrote, read as isolate wrote it.
fn log(text: &str) -> ExecutionLog {
    ExecutionLog::parse(text).expect("log fixture must name a key on every line")
}

/// The sentence a run whose log a test wrote is shown with.
fn shown(text: &str) -> String {
    let run = log(text);
    ExitStatus::of(&run)
        .human_description(&run)
        .expect("readable numbers")
}

#[test]
fn a_line_with_no_key_is_refused_by_its_number() {
    let unnamed = Err(MeasureError::UnnamedLine(2));
    assert_eq!(ExecutionLog::parse("time:1.5\nno key here\n"), unnamed);
}

#[test]
fn a_log_holds_the_two_clocks_the_peak_and_the_first_of_a_repeated_key() {
    let run = log("time:1.5\ntime-wall:2.5\ncg-mem:300\n");
    assert_eq!(run.cpu_time(), Ok(Some(1.5)));
    assert_eq!(run.wall_time(), Ok(Some(2.5)));
    assert_eq!(run.memory_bytes(), Ok(Some(300 * KIB)));
    let twice = log("status:TO\nmessage:wall clock\nmessage:cpu time\n");
    assert_eq!(ExitStatus::of(&twice), ExitStatus::TimeoutWall);
}

#[test]
fn a_sandbox_error_outranks_the_stop_the_kill_and_the_return_beneath_it() {
    let clean = log("time:0.5\n");
    assert_eq!(ExitStatus::of(&clean), ExitStatus::Ok);
    let failed = log("status:XX\nstatus:TO\nstatus:SG\nstatus:RE\n");
    assert_eq!(ExitStatus::of(&failed), ExitStatus::SandboxError);
}

#[test]
fn a_stop_outranks_the_kill_and_the_nonzero_return_beneath_it() {
    let run = log("status:TO\nmessage:wall clock\nstatus:SG\nstatus:RE\n");
    assert_eq!(ExitStatus::of(&run), ExitStatus::TimeoutWall);
}

#[test]
fn a_kill_outranks_the_nonzero_return_and_the_return_stands_alone() {
    let killed = log("status:SG\nstatus:RE\n");
    assert_eq!(ExitStatus::of(&killed), ExitStatus::Signal);
    let returned = log("status:RE\n");
    assert_eq!(ExitStatus::of(&returned), ExitStatus::NonzeroReturn);
}

#[test]
fn a_stop_is_a_wall_clock_stop_only_when_its_message_names_the_wall_clock() {
    let wall = log("status:TO\nmessage:wall clock limit exceeded\n");
    assert_eq!(ExitStatus::of(&wall), ExitStatus::TimeoutWall);
    let cpu = log("status:TO\nmessage:cpu time limit exceeded\n");
    assert_eq!(ExitStatus::of(&cpu), ExitStatus::Timeout);
    let mute = log("status:TO\n");
    assert_eq!(ExitStatus::of(&mute), ExitStatus::Timeout);
}

#[test]
fn a_kill_is_the_memory_limit_only_when_the_isolate_ran_out_of_memory() {
    let oom = log("status:SG\ncg-oom-killed:1\n");
    assert_eq!(ExitStatus::of(&oom), ExitStatus::MemoryLimit);
    let signalled = log("status:SG\n");
    assert_eq!(ExitStatus::of(&signalled), ExitStatus::Signal);
}

#[test]
fn a_run_that_measured_nothing_reads_as_none_and_as_zero() {
    let run = log("exitcode:1\nexitsig:9\n");
    assert_eq!(run.cpu_time(), Ok(None));
    assert_eq!(run.wall_time(), Ok(None));
    assert_eq!(run.memory_bytes(), Ok(None));
    assert_eq!(run.exit_code(), Ok(1));
    assert_eq!(run.killing_signal(), Ok(9));
    let bare = log("");
    assert_eq!(bare.exit_code(), Ok(0));
    assert_eq!(bare.killing_signal(), Ok(0));
}

#[test]
fn a_value_that_is_not_a_number_is_refused_with_the_key_that_claimed_it() {
    let refused = Err(MeasureError::Unreadable {
        key: "time",
        value: "soon".to_owned(),
    });
    assert_eq!(log("time:soon\n").cpu_time(), refused);
}

#[test]
fn every_status_carries_its_own_sentence() {
    let expected = [
        (
            "exitcode:0\n",
            "Execution successfully finished (with exit code 0)",
        ),
        ("status:XX\n", "Execution failed because of sandbox error"),
        ("status:TO\n", "Execution timed out"),
        (
            "status:TO\nmessage:wall clock\n",
            "Execution timed out (wall clock limit exceeded)",
        ),
        ("status:SG\nexitsig:9\n", "Execution killed with signal 9"),
        (
            "status:SG\ncg-oom-killed:1\n",
            "Execution killed because it exceeded the memory limit",
        ),
        (
            "status:RE\n",
            "Execution failed because the return code was nonzero",
        ),
    ];
    for (written, sentence) in expected {
        assert_eq!(shown(written), sentence, "for the log {written}");
    }
}

#[test]
fn a_stop_is_not_refused_over_a_signal_it_never_wrote() {
    let run = log("status:TO\nexitsig:unknown\n");
    let described = ExitStatus::of(&run).human_description(&run);
    assert_eq!(described, Ok(shown("status:TO\n")));
}
