//! The statistics of one run, and what several runs fold into.
//!
//! The fixtures are the text isolate would have written plus figures given
//! outright, so a mapping and a merge are decided by what is handed in rather
//! than by anything launched. Nothing sleeps and nothing is measured.

use cms_worker::{ExecutionLog, ExecutionStats, ExitStatus};

/// Kibibytes in the byte count a memory figure is reported as.
const KIB: u64 = 1024;

/// What separates two outputs once several runs are merged into one.
const SEPARATOR: &str = "\n===\n";

/// A log a test wrote, read as isolate wrote it.
fn log(text: &str) -> ExecutionLog {
    ExecutionLog::parse(text).expect("log fixture must name a key on every line")
}

/// The stats of a run whose log a test wrote.
fn stats(text: &str) -> ExecutionStats {
    ExecutionStats::of(&log(text)).expect("log fixture must hold readable numbers")
}

/// Stats with every figure given, for the rules a merge decides.
const fn measured(cpu: f64, wall: f64, peak_kib: u64, exit_status: ExitStatus) -> ExecutionStats {
    ExecutionStats {
        cpu_time: Some(cpu),
        wall_time: Some(wall),
        memory_bytes: Some(peak_kib * KIB),
        exit_status,
        signal: None,
        stdout: None,
        stderr: None,
    }
}

#[test]
fn a_signal_kill_carries_its_signal_and_a_memory_limit_carries_none() {
    assert_eq!(stats("status:SG\nexitsig:9\n").signal, Some(9));
    assert_eq!(stats("status:TO\n").signal, None);
    assert_eq!(
        stats("status:SG\ncg-oom-killed:1\nexitsig:9\n").signal,
        None
    );
}

#[test]
fn a_run_reports_the_figures_it_measured_and_the_reason_it_ended() {
    let run = stats("time:1.5\ntime-wall:2.5\ncg-mem:300\nstatus:RE\n");
    assert_eq!(run.cpu_time, Some(1.5));
    assert_eq!(run.wall_time, Some(2.5));
    assert_eq!(run.memory_bytes, Some(300 * KIB));
    assert_eq!(run.exit_status, ExitStatus::NonzeroReturn);
    assert_eq!(run.stdout, None);
}

#[test]
fn two_runs_at_once_share_one_clock_and_two_in_turn_add_their_clocks() {
    let first = measured(1.0, 5.0, 100, ExitStatus::Ok);
    let second = measured(2.0, 3.0, 40, ExitStatus::Ok);
    let at_once = first.merged_with(&second, true);
    assert_eq!(at_once.cpu_time, Some(3.0));
    assert_eq!(at_once.wall_time, Some(5.0));
    assert_eq!(at_once.memory_bytes, Some(140 * KIB));
    let in_turn = first.merged_with(&second, false);
    assert_eq!(in_turn.cpu_time, Some(3.0));
    assert_eq!(in_turn.wall_time, Some(8.0));
    assert_eq!(in_turn.memory_bytes, Some(100 * KIB));
}

#[test]
fn the_first_status_stands_and_a_clean_first_answers_with_the_second() {
    let stopped = measured(1.0, 1.0, 10, ExitStatus::Timeout);
    let killed = measured(1.0, 1.0, 10, ExitStatus::Signal);
    let clean = measured(1.0, 1.0, 10, ExitStatus::Ok);
    let kept = stopped.merged_with(&killed, true);
    let taken = clean.merged_with(&killed, true);
    assert_eq!(kept.exit_status, ExitStatus::Timeout);
    assert_eq!(taken.exit_status, ExitStatus::Signal);
}

#[test]
fn the_signal_follows_the_status_the_merge_reports() {
    let mut first_kill = measured(1.0, 1.0, 10, ExitStatus::Signal);
    first_kill.signal = Some(9);
    let mut second_kill = measured(1.0, 1.0, 10, ExitStatus::Signal);
    second_kill.signal = Some(11);
    let clean = measured(1.0, 1.0, 10, ExitStatus::Ok);
    assert_eq!(clean.merged_with(&first_kill, true).signal, Some(9));
    assert_eq!(first_kill.merged_with(&second_kill, true).signal, Some(9));
    assert_eq!(first_kill.merged_with(&clean, true).signal, Some(9));
}

#[test]
fn collected_output_is_joined_and_kept_alone_when_one_side_printed_none() {
    let mut first = measured(1.0, 1.0, 10, ExitStatus::Ok);
    first.stdout = Some("first out".to_owned());
    first.stderr = Some("first err".to_owned());
    let mut second = measured(1.0, 1.0, 10, ExitStatus::Ok);
    second.stdout = Some("second out".to_owned());
    let merged = first.merged_with(&second, true);
    assert_eq!(
        merged.stdout,
        Some(format!("first out{SEPARATOR}second out"))
    );
    assert_eq!(merged.stderr, Some("first err".to_owned()));
    assert_eq!(
        second.merged_with(&first, true).stderr,
        Some("first err".to_owned())
    );
    let silent = measured(1.0, 1.0, 10, ExitStatus::Ok);
    let alone = first.merged_with(&silent, true);
    assert_eq!(alone.stdout, Some("first out".to_owned()));
    assert_eq!(silent.merged_with(&silent, true).stdout, None);
}

#[test]
fn a_figure_nothing_measured_leaves_the_other_alone() {
    let mut unmeasured = measured(0.0, 0.0, 0, ExitStatus::Ok);
    unmeasured.cpu_time = None;
    unmeasured.wall_time = None;
    unmeasured.memory_bytes = None;
    let taken = measured(2.0, 3.0, 40, ExitStatus::Ok);
    let merged = unmeasured.merged_with(&taken, true);
    assert_eq!(merged.cpu_time, Some(2.0));
    assert_eq!(merged.wall_time, Some(3.0));
    assert_eq!(merged.memory_bytes, Some(40 * KIB));
    assert_eq!(merged.merged_with(&unmeasured, false).cpu_time, Some(2.0));
}
