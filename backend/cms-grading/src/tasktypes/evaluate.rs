#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::path::PathBuf;
use std::time::Duration;

use crate::job::EvaluationJob;
use crate::stage::Cache;
use cms_sandbox::ExecutionStats;
use cms_sandbox::Options;

use super::batch::Batch;
use super::judge::{self, OutputSource, CHECKER_CODENAME};
use super::outcome::{decide, Evaluation};
use super::{handle, wall_clock_of, Run, Runtime, Shared, TaskError, Toolchain};

const EVALUATE_BOX: &str = "evaluate";
const EXECUTABLES_REQUIRED: usize = 1;
const ERROR_FILENAME: &str = "stderr.txt";
const LIMIT_TIME: &str = "time limit";
const LIMIT_MEMORY: &str = "memory limit";
const SINGLE_PROCESS: u32 = 1;
const MULTIPROCESS_LIMIT: u32 = 1000;

impl Batch {
    pub(super) fn checker(&self) -> Option<&'static str> {
        self.uses_comparator().then_some(CHECKER_CODENAME)
    }

    /// Reuses the Batch phase without letting task types copy its staging and limits.
    pub fn evaluate(
        &self,
        job: &EvaluationJob,
        toolchain: &dyn Toolchain,
        runtime: &Runtime,
        store: Box<dyn Cache>,
    ) -> Result<Evaluation, TaskError> {
        self.evaluate_with(job, toolchain, runtime, store, &[])
    }

    /// Adds checker arguments without changing the shared evaluation order.
    pub fn evaluate_with(
        &self,
        job: &EvaluationJob,
        toolchain: &dyn Toolchain,
        runtime: &Runtime,
        store: Box<dyn Cache>,
        extra_args: &[String],
    ) -> Result<Evaluation, TaskError> {
        let executable = only_executable(job)?;
        let main = self.main_of(&executable.0);
        let commands = toolchain.evaluation_commands(&executable.0, &main, &[]);
        let store = Shared::of(store);
        let mut run = runtime.open_shared(EVALUATE_BOX, store.arc())?;
        stage_run(&run, self, job, &executable)?;
        let mut last: Option<ExecutionStats> = None;
        for command in &commands {
            let mut options = run_options(&mut run, self, job)?;
            options.file_size = runtime.file_size;
            last = Some(run.launch(command, &options)?);
        }
        let mut evaluation = decide(last);
        if evaluation.success {
            evaluation.judge(&run, self, job)?;
        }
        if let Some(answer) = evaluation.output_file.clone() {
            let judged = judge::eval_output(
                job,
                self.checker(),
                OutputSource::Path(answer.path),
                &answer.filename,
                extra_args,
                runtime,
                store.arc(),
            )?;
            evaluation.absorb(judged);
        }
        let keep = job.archive_sandbox || !evaluation.success;
        run.close(keep, job.archive_sandbox)?
            .record_first(&mut evaluation.sandboxes, &mut evaluation.sandbox_digests);
        Ok(evaluation)
    }
}

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
