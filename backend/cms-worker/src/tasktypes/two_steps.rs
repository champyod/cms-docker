//! The Two Steps task type: one program run twice, the first computing something the
//! second has to recover, the two talking through a single named pipe.
//!
//! The order is the reference's and the only one that works. The pipe's directory is
//! made before either box, because a box is handed it as a directory to make visible
//! and one that is not there cannot be made visible. Each box is handed the manager it
//! runs — the one executable a result holds — and only the first is handed the input.
//! Both runs are then started before either is waited for: the first writes down the
//! pipe and the second reads up it, so a first waited for before the second started
//! would wait for a reader that had not been started. What the two were charged is
//! then merged as one run's, for they were alive at once.
//!
//! The answer is read in the order the reference reads it: a box that did not work is
//! undecided, a stopped or killed run is told why, the second phase's answer is judged
//! on the file it was told to write, and a job that only asked to be run is answered
//! before any of that. What the answer is worth is left to the comparison, as a
//! [`Batch`](super::Batch) evaluation leaves its file to it.
//!
//! # Errors
//!
//! [`TaskError`], and only that: parameters that are not the one a Two Steps task has, a
//! result holding a number of executables other than one, a limit the dataset set that
//! is not a positive number, a directory or a named pipe that could not be made, a file
//! the store would not hand over, and a run the box could not carry or read back.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::fs;
use std::io;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;

use crate::job::EvaluationJob;
use crate::measure::ExitStatus;
use crate::sandbox::{Launch, MappedDirectory, Options};
use crate::stage::{Cache, CacheHandle, FileDigest, StageError};
use crate::stats::ExecutionStats;

use super::evaluate::what_went_wrong;
use super::{handle, wall_clock_of, Evaluation, OutputFile, Run, Runtime, TaskError, Toolchain};

const INPUT: &str = "input.txt";
const OUTPUT: &str = "output.txt";
/// Where inside a box the pipe's directory is seen, and the name the pipe has inside
/// it, which is the name both phases are handed as their third argument.
const PIPE_MOUNT: &str = "/fifo";
const PIPE_NAME: &str = "fifo";
const FIFO_DIRECTORY: &str = "cms-two-steps-fifo";
/// How many evaluations this worker has made, which is what tells two pipes apart when
/// two of them share one temporary directory, as the reference's own fresh directory
/// per evaluation does.
static EVALUATIONS: AtomicU64 = AtomicU64::new(0);
const EXECUTABLES_REQUIRED: usize = 1;
const OUTPUT_EVAL_COMPARATOR: &str = "comparator";
const NO_CREDIT: f64 = 0.0;
const NO_OUTPUT: &str = "Evaluation didn't produce file";
const EXECUTED: &str = "Execution completed successfully";
const LIMIT_TIME: &str = "time limit";
const LIMIT_MEMORY: &str = "memory limit";
const SINGLE_PROCESS: u32 = 1;
const MULTIPROCESS_LIMIT: u32 = 1000;
const RULE_READ_WRITE: &str = "rw";
const MODE_DIRECTORY: u32 = 0o755;
const MODE_PIPE: u32 = 0o666;
const NAMED_PIPE_PROGRAM: &str = "mkfifo";

/// One phase: the box it runs in, the step its manager is told it is, the file it
/// reads from that box, and the file its answer is written to. Only the first phase
/// reads the input and only the second writes the answer.
struct Phase {
    name: &'static str,
    step: &'static str,
    input: Option<&'static str>,
    answer: Option<&'static str>,
}

const FIRST: Phase = Phase {
    name: "first_evaluate",
    step: "0",
    input: Some(INPUT),
    answer: None,
};
const SECOND: Phase = Phase {
    name: "second_evaluate",
    step: "1",
    input: None,
    answer: Some(OUTPUT),
};

/// The Two Steps task type, as its one parameter says.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TwoSteps {
    output_eval: String,
}

impl TwoSteps {
    /// Reads the one parameter a Two Steps task type is configured with: whether the
    /// second phase's answer is compared with a white diff or by a comparator.
    ///
    /// # Errors
    ///
    /// [`TaskError::Parameters`] unless the parameters hold exactly one string.
    pub fn new(parameters: &Value) -> Result<Self, TaskError> {
        let entries = parameters.as_array().ok_or(TaskError::Parameters)?;
        let [output_eval] = entries.as_slice() else {
            return Err(TaskError::Parameters);
        };
        let output_eval = output_eval.as_str().ok_or(TaskError::Parameters)?;
        Ok(Self {
            output_eval: output_eval.to_owned(),
        })
    }

    /// Whether a comparator the dataset holds reads the second phase's answer, rather
    /// than the two files being diffed.
    #[must_use]
    pub fn uses_comparator(&self) -> bool {
        self.output_eval == OUTPUT_EVAL_COMPARATOR
    }

    /// Judges one submission on one testcase by running the manager twice, the first
    /// computing and the second recovering, both through one pipe.
    ///
    /// # Errors
    ///
    /// [`TaskError`], and only that: everything this module's own Errors section
    /// names, which is what each of the steps below refuses.
    pub fn evaluate(
        &self,
        job: &EvaluationJob,
        toolchain: &dyn Toolchain,
        runtime: &Runtime,
        store: Box<dyn Cache>,
    ) -> Result<Evaluation, TaskError> {
        let (executable, digest) = one_executable(job)?;
        let shared = Shared(Arc::from(store));
        let pipe = pipe_dir(runtime.temp_dir())?;
        let mut first = open_phase(runtime, &shared, &FIRST, &executable, &digest, &job.input)?;
        let mut second = open_phase(runtime, &shared, &SECOND, &executable, &digest, &job.input)?;
        let one = start(
            &mut first,
            job,
            toolchain,
            runtime,
            &executable,
            &pipe,
            &FIRST,
        )?;
        let two = start(
            &mut second,
            job,
            toolchain,
            runtime,
            &executable,
            &pipe,
            &SECOND,
        )?;
        let (one_stats, two_stats) = (
            one.wait().map_err(TaskError::Spawn)?,
            two.wait().map_err(TaskError::Spawn)?,
        );
        let mut evaluation = decide(&one_stats, &two_stats);
        if evaluation.success {
            judge(&mut evaluation, &second, job)?;
        }
        let keep = job.archive_sandbox || !evaluation.success;
        evaluation.sandboxes = vec![first.close(keep)?, second.close(keep)?];
        if !keep {
            let gone = fs::remove_dir_all(&pipe);
            gone.map_err(|source| TaskError::Stage(StageError::io(&pipe, &source)))?;
        }
        Ok(evaluation)
    }
}

/// Fills in the score and the sentences once both boxes have worked, in the
/// reference's order: a run that did not do what it was asked to is told why, an
/// answer that was never written is said so, and a job that only asked to be run is
/// answered before the answer is looked for.
fn judge(evaluation: &mut Evaluation, second: &Run, job: &EvaluationJob) -> Result<(), TaskError> {
    if !evaluation.ran {
        evaluation.outcome = Some(NO_CREDIT);
        evaluation.text = evaluation
            .stats
            .as_ref()
            .map_or_else(Vec::new, what_went_wrong);
        return Ok(());
    }
    if !second.files().path(OUTPUT).is_file() {
        evaluation.outcome = Some(NO_CREDIT);
        evaluation.text = vec![NO_OUTPUT.to_owned(), OUTPUT.to_owned()];
        return Ok(());
    }
    if job.get_output.unwrap_or(false) {
        evaluation.user_output = Some(second.files().store(OUTPUT)?);
    }
    if job.only_execution.unwrap_or(false) {
        evaluation.outcome = Some(NO_CREDIT);
        evaluation.text = vec![EXECUTED.to_owned()];
        return Ok(());
    }
    evaluation.output_file = Some(OutputFile {
        path: second.files().path(OUTPUT),
        filename: OUTPUT.to_owned(),
    });
    Ok(())
}

/// The one store every box of an evaluation reads, shared rather than split: a `Box`
/// cannot be handed to two and the reference passes its file cacher to every sandbox.
#[derive(Clone)]
struct Shared(Arc<dyn Cache>);

impl Cache for Shared {
    fn get_file(&self, handle: &CacheHandle) -> Result<Vec<u8>, StageError> {
        self.0.get_file(handle)
    }

    fn put_file(&self, digest: &FileDigest, content: &[u8]) -> Result<bool, StageError> {
        self.0.put_file(digest, content)
    }
}

fn one_executable(job: &EvaluationJob) -> Result<(String, String), TaskError> {
    let unexpected = || TaskError::UnexpectedExecutables {
        found: job.executables.len(),
        wanted: EXECUTABLES_REQUIRED,
    };
    if job.executables.len() != EXECUTABLES_REQUIRED {
        return Err(unexpected());
    }
    let (name, digest) = job.executables.iter().next().ok_or_else(unexpected)?;
    Ok((name.clone(), digest.clone()))
}

/// The pipe's directory and the pipe in it, made before any box, and given the
/// permissions a box writing in either of them needs.
fn pipe_dir(temp_dir: &Path) -> Result<PathBuf, TaskError> {
    let number = EVALUATIONS.fetch_add(1, Ordering::Relaxed);
    let outer = temp_dir.join(format!("{FIFO_DIRECTORY}-{number}"));
    let pipe = outer.join(PIPE_NAME);
    fs::create_dir_all(&outer).map_err(|source| at(&outer, &source))?;
    let made = Command::new(NAMED_PIPE_PROGRAM).arg(&pipe).status();
    let status = made.map_err(|source| at(&pipe, &source))?;
    if !status.success() {
        let reason = format!("{NAMED_PIPE_PROGRAM} refused to make {}", pipe.display());
        return Err(TaskError::Stage(StageError::Store { reason }));
    }
    for (path, mode) in [(&outer, MODE_DIRECTORY), (&pipe, MODE_PIPE)] {
        let granted = fs::set_permissions(path, fs::Permissions::from_mode(mode));
        granted.map_err(|source| at(path, &source))?;
    }
    Ok(outer)
}

/// A refusal the file system made, named by the path it was made on.
fn at(path: &Path, source: &io::Error) -> TaskError {
    TaskError::Stage(StageError::io(path, source))
}

/// The box of one phase, handed the manager it runs and, where that phase reads one,
/// the testcase's input under the name it is read from.
fn open_phase(
    runtime: &Runtime,
    store: &Shared,
    phase: &Phase,
    executable: &str,
    digest: &str,
    input: &str,
) -> Result<Run, TaskError> {
    let run = runtime.open(phase.name, Box::new(store.clone()))?;
    run.files()
        .write_from_storage(executable, &handle(digest)?, true)?;
    if let Some(name) = phase.input {
        run.files()
            .write_from_storage(name, &handle(input)?, false)?;
    }
    Ok(run)
}

/// Starts one phase and hands the run back, still running, so that a caller needing
/// both alive at once can start this one before it waits for either.
fn start(
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

/// What the two phases' figures say, merged as one run's for they were alive at once:
/// a box that did not work is undecided, a stopped, killed or non-zero run did not do
/// what it was asked to, and the figures of a box that failed are of nothing.
fn decide(first: &ExecutionStats, second: &ExecutionStats) -> Evaluation {
    let worked = |stats: &ExecutionStats| stats.exit_status != ExitStatus::SandboxError;
    let clean = |stats: &ExecutionStats| stats.exit_status == ExitStatus::Ok;
    let success = worked(first) && worked(second);
    Evaluation {
        sandboxes: Vec::new(),
        success,
        ran: clean(first) && clean(second),
        outcome: None,
        text: Vec::new(),
        stats: if success {
            Some(first.merged_with(second, true))
        } else {
            None
        },
        user_output: None,
        output_file: None,
    }
}
