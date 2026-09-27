//! The evaluation phase: the executable and the input a run is handed, the limits
//! it is held to, and what the run's own answer is worth.
//!
//! The order is the reference's. The executable is the only one a Batch result
//! holds, and the name it is judged by comes from the parameters. Then the two
//! streams, which the two filenames decide: an empty one is a redirect to the
//! default file and a named one is a file the run opens itself. Then the limits,
//! which are the dataset's rather than the compilation's.
//!
//! What the run did with them is read in the same order: a box that did not work
//! is undecided, a run that was stopped or killed was charged nothing and is told
//! why, and a run that answered is judged on the file it was told to write.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::path::PathBuf;
use std::time::Duration;

use crate::job::EvaluationJob;
use crate::measure::ExitStatus;
use crate::sandbox::Options;
use crate::stage::{Cache, FileDigest};
use crate::stats::ExecutionStats;

use super::batch::Batch;
use super::{handle, wall_clock_of, Run, Runtime, TaskError, Toolchain};

const EVALUATE_BOX: &str = "evaluate";
const EXECUTABLES_REQUIRED: usize = 1;
const NO_CREDIT: f64 = 0.0;
const ERROR_FILENAME: &str = "stderr.txt";
const LIMIT_TIME: &str = "time limit";
const LIMIT_MEMORY: &str = "memory limit";
/// The processes a run may have alive at once, and the ceiling a multithreaded
/// one is given so that a fork bomb is bounded rather than enabled.
const SINGLE_PROCESS: u32 = 1;
const MULTIPROCESS_LIMIT: u32 = 1000;
/// The sentences a report shows for a run that did not answer. The first of the
/// list of text is the message and the rest are its arguments, as the reference
/// hands a message and its arguments over; a code a run returned is not quoted.
const NO_OUTPUT: &str = "Evaluation didn't produce file";
const TIMED_OUT: &str = "Execution timed out";
const WALL_TIMED_OUT: &str = "Execution timed out (wall clock limit exceeded)";
const MEMORY_EXCEEDED: &str = "Memory limit exceeded";
const KILLED: &str = "Execution killed by signal";
const NONZERO_RETURN: &str = "Execution failed because the return code was nonzero";
const EXECUTED: &str = "Execution completed successfully";

/// What an evaluation left behind, as the result is filed.
#[derive(Debug, Clone, PartialEq)]
pub struct Evaluation {
    /// The paths the report names this evaluation's box by.
    pub sandboxes: Vec<PathBuf>,
    /// Whether the box worked, so that what the run reported can be believed.
    pub success: bool,
    /// Whether the run itself did what it was asked to, as against one stopped,
    /// killed or returned non-zero. It means nothing unless the box worked.
    pub ran: bool,
    /// The score, zero when the run did not answer, absent when the box did not work.
    pub outcome: Option<f64>,
    /// The sentences a report shows, the first of which the rest are arguments for.
    pub text: Vec<String>,
    /// What the run was charged, absent when no run was measured.
    pub stats: Option<ExecutionStats>,
    /// The digest of the run's answer, absent unless the job asked for it.
    pub user_output: Option<FileDigest>,
    /// The file the answer is in and the name the run was told to write, absent
    /// once the run is judged here.
    pub output_file: Option<OutputFile>,
}

/// The file a run wrote its answer to, and the name it was told to write.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutputFile {
    /// Where the answer is, on this side of the box.
    pub path: PathBuf,
    /// The filename the parameters named, empty where the answer is a redirect.
    pub filename: String,
}

impl Batch {
    /// Evaluates one submission on one testcase, in the reference's order.
    ///
    /// # Errors
    ///
    /// [`TaskError`], and only that: a result holding a number of executables
    /// other than one, a limit that is not positive, a file the store would not
    /// hand over, and a run the box could not carry or read back.
    pub fn evaluate(
        &self,
        job: &EvaluationJob,
        toolchain: &dyn Toolchain,
        runtime: &Runtime,
        store: Box<dyn Cache>,
    ) -> Result<Evaluation, TaskError> {
        let executable = only_executable(job)?;
        let main = self.main_of(&executable.0);
        let commands = toolchain.evaluation_commands(&executable.0, &main);
        let mut run = runtime.open(EVALUATE_BOX, store)?;
        stage_run(&run, self, job, &executable)?;
        let mut last: Option<ExecutionStats> = None;
        for command in &commands {
            let options = run_options(&mut run, self, job)?;
            last = Some(run.launch(command, &options)?);
        }
        let mut evaluation = decide(last);
        if evaluation.success {
            evaluation.judge(&run, self, job)?;
        }
        let keep = job.archive_sandbox || !evaluation.success;
        evaluation.sandboxes.push(run.close(keep)?);
        Ok(evaluation)
    }
}

/// The one executable a result holds: the count is the reference's check, and the
/// entry read once it is right is the first of the one that is there.
fn only_executable(job: &EvaluationJob) -> Result<(String, String), TaskError> {
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

/// Hands the run the executable it is to execute and the input it is to read.
fn stage_run(
    run: &Run,
    batch: &Batch,
    job: &EvaluationJob,
    executable: &(String, String),
) -> Result<(), TaskError> {
    let program = handle(&executable.1)?;
    let input = handle(&job.input)?;
    let files = run.files();
    files.write_from_storage(&executable.0, &program, true)?;
    Ok(files.write_from_storage(batch.actual_input(), &input, false)?)
}

/// The options an evaluation run is launched under: the dataset's two limits and
/// the two streams the parameters ask for, over the options the box already
/// carries. A limit that bounds nothing is refused rather than turned into a flag
/// no run could be stopped by.
fn run_options(run: &mut Run, batch: &Batch, job: &EvaluationJob) -> Result<Options, TaskError> {
    let time = match job.time_limit {
        Some(seconds) if seconds <= 0.0 => return Err(bounded_by(LIMIT_TIME, seconds)),
        Some(seconds) => Some(Duration::from_secs_f64(seconds)),
        None => None,
    };
    let memory = match job.memory_limit {
        Some(bytes) if bytes <= 0 => return Err(bounded_by(LIMIT_MEMORY, bytes as f64)),
        Some(bytes) => Some(bytes as u64),
        None => None,
    };
    let processes = if job.multithreaded_sandbox {
        MULTIPROCESS_LIMIT
    } else {
        SINGLE_PROCESS
    };
    let mut options = run.sandbox().options().clone();
    let input = batch.actual_input();
    let output = batch.actual_output();
    options.cpu_time = time;
    options.wall_clock_timeout = time.map(wall_clock_of);
    options.address_space = memory;
    options.max_processes = Some(processes);
    options.stdin_file = batch.redirects_stdin().then(|| PathBuf::from(input));
    options.stdout_file = batch.redirects_stdout().then(|| PathBuf::from(output));
    options.stderr_file = Some(PathBuf::from(ERROR_FILENAME));
    Ok(options)
}

/// The refusal a limit set to a number that bounds nothing is reported as.
fn bounded_by(limit: &'static str, value: f64) -> TaskError {
    TaskError::NonPositiveLimit { limit, value }
}

/// What a run's figures say, undecided when there was no command to run or the
/// box itself did not work: the figures of a box that failed are of nothing.
fn decide(stats: Option<ExecutionStats>) -> Evaluation {
    let (success, ran) = match stats.as_ref().map(|stats| stats.exit_status) {
        Some(ExitStatus::Ok) => (true, true),
        Some(ExitStatus::SandboxError) | None => (false, false),
        Some(_) => (true, false),
    };
    Evaluation {
        sandboxes: Vec::new(),
        success,
        ran,
        outcome: None,
        text: Vec::new(),
        stats: if success { stats } else { None },
        user_output: None,
        output_file: None,
    }
}

/// The one sentence a report shows for a run that did not do what it was asked
/// to, and nothing for a run that ended cleanly: a run that answered is judged on
/// its answer rather than on this.
fn what_went_wrong(stats: &ExecutionStats) -> Vec<String> {
    let message = match stats.exit_status {
        ExitStatus::Timeout => Some(TIMED_OUT),
        ExitStatus::TimeoutWall => Some(WALL_TIMED_OUT),
        ExitStatus::MemoryLimit => Some(MEMORY_EXCEEDED),
        ExitStatus::Signal => Some(KILLED),
        ExitStatus::NonzeroReturn => Some(NONZERO_RETURN),
        ExitStatus::Ok | ExitStatus::SandboxError => None,
    };
    message
        .map(|said| vec![said.to_owned()])
        .unwrap_or_default()
}

impl Evaluation {
    /// Judges a run that came back: whether it wrote the file it was told to
    /// write, the digest of it where the job asked, and the file to compare.
    fn judge(&mut self, run: &Run, batch: &Batch, job: &EvaluationJob) -> Result<(), TaskError> {
        if !self.ran {
            self.outcome = Some(NO_CREDIT);
            self.text = self.stats.as_ref().map_or_else(Vec::new, what_went_wrong);
            return Ok(());
        }
        let output = batch.actual_output();
        if !run.files().path(output).is_file() {
            self.outcome = Some(NO_CREDIT);
            self.text = vec![NO_OUTPUT.to_owned(), output.to_owned()];
            return Ok(());
        }
        if job.get_output.unwrap_or(false) {
            self.user_output = Some(run.files().store(output)?);
        }
        if job.only_execution.unwrap_or(false) {
            self.outcome = Some(NO_CREDIT);
            self.text = vec![EXECUTED.to_owned()];
            return Ok(());
        }
        self.output_file = Some(OutputFile {
            path: run.files().path(output),
            filename: batch.output_filename().to_owned(),
        });
        Ok(())
    }
}
