//! What the processes of one evaluation were charged, and the total read against
//! the dataset's limit.
//!
//! The processes were alive at once, so their figures are merged as one run's: the
//! CPU time is added, the clock is the wider of the two and the peak is added. No
//! single box can see that total, so a set of processes that between them were
//! charged at least the limit is read as a timeout, which is the only place the
//! reference catches it either.
//!
//! The two limits a run is held to are the dataset's own, and a limit set to a
//! number that bounds nothing is refused rather than turned into a flag no run
//! could be stopped by.
//!
//! # Errors
//!
//! [`TaskError::NonPositiveLimit`], and only that: a time or memory limit the
//! dataset set to zero or below.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::time::Duration;

use crate::job::EvaluationJob;
use crate::measure::ExitStatus;
use crate::stats::ExecutionStats;

use super::TaskError;

/// Which of the two limits a refusal is about.
const LIMIT_TIME: &str = "time limit";
const LIMIT_MEMORY: &str = "memory limit";
/// What a run is granted on top of its own limit, so that stopping a run is not
/// instant and a manager waiting on every process is given the sum of what those
/// processes are each given.
const GRACE: Duration = Duration::from_secs(1);
/// The processes a run may have alive at once, and the ceiling a multithreaded one
/// is given so a fork bomb is bounded rather than enabled.
const SINGLE_PROCESS: u32 = 1;
const MULTIPROCESS_LIMIT: u32 = 1000;

/// The clock a process is held to, which is the dataset's own time limit.
///
/// The manager is given a wider clock than this, and [`manager_clock`] is where
/// that is said.
pub(super) fn time_of(job: &EvaluationJob) -> Result<Option<Duration>, TaskError> {
    let Some(seconds) = job.time_limit else {
        return Ok(None);
    };
    if seconds <= 0.0 {
        return Err(bounded_by(LIMIT_TIME, seconds));
    }
    Ok(Some(Duration::from_secs_f64(seconds)))
}

/// The clock the manager is held to: the dataset's own limit and one second more
/// for each process on top of it.
///
/// This is the reference's own number with the operator's own floor left out,
/// because this worker holds no configuration: a manager is given
/// `processes × (time limit + 1 second)` and no more, which is what keeps a
/// process from sending the manager into a stop by waiting on it, and the manager
/// from stopping before every process it is waiting for has been given its own.
pub(super) fn manager_clock(processes: usize, time: Option<Duration>) -> Option<Duration> {
    time.map(|limit| limit * processes as u32 + GRACE)
}

/// The memory a process is held to, which is the dataset's own, and the reference's.
pub(super) fn memory_of(job: &EvaluationJob) -> Result<Option<u64>, TaskError> {
    let Some(bytes) = job.memory_limit else {
        return Ok(None);
    };
    if bytes <= 0 {
        return Err(bounded_by(LIMIT_MEMORY, bytes as f64));
    }
    Ok(Some(bytes as u64))
}

/// How many processes a run may have alive at once, which is one unless the job
/// says the sandbox may be multithreaded.
pub(super) fn processes_of(job: &EvaluationJob) -> u32 {
    if job.multithreaded_sandbox {
        MULTIPROCESS_LIMIT
    } else {
        SINGLE_PROCESS
    }
}

/// The refusal a limit set to a number that bounds nothing is reported as.
fn bounded_by(limit: &'static str, value: f64) -> TaskError {
    TaskError::NonPositiveLimit { limit, value }
}

/// The figures of every process as one run's, with the total read against the
/// limit and reclassified where the total reached it.
///
/// `every_ran` is whether every process ended cleanly on its own account, and is
/// the condition the reference puts on the reclassification: a process that was
/// already stopped is blamed for itself, and the total is not added to its blame.
pub(super) fn charged(
    users: Vec<ExecutionStats>,
    time_limit: Option<f64>,
    every_ran: bool,
) -> ExecutionStats {
    let mut runs = users.into_iter();
    let first = runs.next().unwrap_or_else(clean);
    let mut total = runs.fold(first, |merged, next| merged.merged_with(&next, true));
    if every_ran && over(&total, time_limit) {
        total.exit_status = ExitStatus::Timeout;
    }
    total
}

/// A run that measured nothing, which the parameters rule out and which is answered
/// as a box that did not work rather than as a run that cost nothing.
fn clean() -> ExecutionStats {
    ExecutionStats {
        cpu_time: None,
        wall_time: None,
        memory_bytes: None,
        exit_status: ExitStatus::SandboxError,
        signal: None,
        stdout: None,
        stderr: None,
    }
}

/// Whether the CPU time every process was charged adds up to at least the dataset's
/// limit, which no single box can see and only the total answers.
fn over(total: &ExecutionStats, time_limit: Option<f64>) -> bool {
    match (total.cpu_time, time_limit) {
        (Some(charged), Some(limit)) => charged >= limit,
        _ => false,
    }
}
