//! Starting each phase under the dataset's own limits, and handing the run back
//! still running.
//!
//! A run is handed back rather than waited for, because the two phases have to be
//! alive at once for either to make progress: the first writes down the pipe and the
//! second reads up it, so a phase waited for before the other was started would wait
//! for a reader that had not been started.
//!
//! # Errors
//!
//! [`TaskError`], and only that: a limit the dataset set that is not a positive
//! number, and a run the box could not carry.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::job::EvaluationJob;
use crate::sandbox::{Launch, MappedDirectory, Options};
use crate::tasktypes::{wall_clock_of, Run, Runtime, TaskError, Toolchain};

use super::{Phase, PIPE_MOUNT, PIPE_NAME};

const LIMIT_TIME: &str = "time limit";
const LIMIT_MEMORY: &str = "memory limit";
const SINGLE_PROCESS: u32 = 1;
const MULTIPROCESS_LIMIT: u32 = 1000;
const RULE_READ_WRITE: &str = "rw";

/// Starts one phase and hands the run back, still running, so that a caller needing
/// both alive at once can start this one before it waits for either.
pub(super) fn start(
    run: &mut Run,
    job: &EvaluationJob,
    toolchain: &dyn Toolchain,
    runtime: &Runtime,
    executable: &str,
    pipe: &Path,
    phase: &Phase,
) -> Result<Launch, TaskError> {
    let args = [phase.step.to_owned(), format!("{PIPE_MOUNT}/{PIPE_NAME}")];
    let commands = toolchain.evaluation_commands(executable, executable, &args);
    let words: Vec<&str> = commands
        .last()
        .map_or_else(Vec::new, |last| last.iter().map(String::as_str).collect());
    let options = phase_options(run, job, runtime, pipe, phase)?;
    run.started(&words, &options)
}

/// The options one phase is launched under: the dataset's own two limits, the box's
/// bound on how large a file may be, the pipe's directory, and the one stream this
/// phase is redirected. A limit set to a number that bounds nothing is refused rather
/// than turned into a flag no run could be stopped by.
fn phase_options(
    run: &mut Run,
    job: &EvaluationJob,
    runtime: &Runtime,
    pipe: &Path,
    phase: &Phase,
) -> Result<Options, TaskError> {
    let time = match job.time_limit {
        Some(seconds) if seconds <= 0.0 => return Err(bounded_by(LIMIT_TIME, seconds)),
        Some(seconds) => Some(Duration::from_secs_f64(seconds)),
        None => None,
    };
    let memory = match job.memory_limit {
        Some(bytes) if bytes <= 0 => return Err(bounded_by(LIMIT_MEMORY, bytes as f64)),
        Some(bytes) => Some(bytes.unsigned_abs()),
        None => None,
    };
    let processes = if job.multithreaded_sandbox {
        MULTIPROCESS_LIMIT
    } else {
        SINGLE_PROCESS
    };
    let mut options = run.sandbox().options().clone();
    options.cpu_time = time;
    options.wall_clock_timeout = time.map(wall_clock_of);
    options.address_space = memory;
    options.file_size = runtime.file_size;
    options.max_processes = Some(processes);
    let mapping = MappedDirectory::at(pipe.to_path_buf(), PIPE_MOUNT);
    options
        .directories
        .push(mapping.with_options(RULE_READ_WRITE));
    options.stdin_file = phase.input.map(PathBuf::from);
    options.stdout_file = phase.answer.map(PathBuf::from);
    Ok(options)
}

fn bounded_by(limit: &'static str, value: f64) -> TaskError {
    TaskError::NonPositiveLimit { limit, value }
}
