#![deny(missing_docs)]
#![forbid(unsafe_code)]

mod boxes;
mod charge;
mod compile;
mod launch;
mod manager;
mod pipes;
mod verdict;

use serde_json::Value;

use crate::job::EvaluationJob;
use crate::stage::Cache;

use self::pipes::Pipe;
pub use self::verdict::Verdict;
use super::{Parameter, Parameters, Runtime, TaskError, Toolchain};

const MANAGER: &str = "manager";
const INPUT: &str = "input.txt";
const OUTPUT: &str = "output.txt";
const STUB: &str = "stub";
const COMPILATION_ALONE: &str = "alone";
const COMPILATION_STUB: &str = "stub";
/// The choice that tells a process where its pipes are as arguments.
const USER_IO_STD: &str = "std_io";
const USER_IO_FIFOS: &str = "fifo_io";
const EXECUTABLES_REQUIRED: usize = 1;
const NO_CREDIT: f64 = 0.0;

const NUM_PROCESSES: Parameter = Parameter::integer("Number of Processes", "num_processes", "");
/// The compilation choice: by itself, or together with the stub.
const COMPILATION: Parameter = Parameter::choice(
    "Compilation",
    "compilation",
    "",
    &[COMPILATION_ALONE, COMPILATION_STUB],
);
/// The user I/O choice: the pipes as standard input and output, or as arguments.
const USER_IO: Parameter =
    Parameter::choice("User I/O", "user_io", "", &[USER_IO_STD, USER_IO_FIFOS]);
/// The three parameters a Communication task type declares.
static PARAMETERS: [Parameter; 3] = [NUM_PROCESSES, COMPILATION, USER_IO];

#[derive(Debug, Clone, PartialEq, Eq)]
/// Runs a manager beside submission processes that communicate through pipes.
pub struct Communication {
    num_processes: usize,
    compilation: String,
    user_io: String,
}

impl Communication {
    /// Refuses a zero-process task because its merged charge has no meaning.
    pub fn new(parameters: &Value) -> Result<Self, TaskError> {
        let parameters = Parameters::of(parameters, &PARAMETERS)?;
        let count = usize::try_from(parameters.integer(0))
            .ok()
            .filter(|count| *count > 0)
            .ok_or(TaskError::Parameters)?;
        Ok(Self {
            num_processes: count,
            compilation: parameters.text(1).into_owned(),
            user_io: parameters.text(2).into_owned(),
        })
    }

    #[must_use]
    /// Lets callers size pipe and box inventories from the declared process count.
    pub fn processes(&self) -> usize {
        self.num_processes
    }

    /// Whether the submission was compiled together with the stub.
    pub(super) fn uses_stub(&self) -> bool {
        self.compilation == COMPILATION_STUB
    }

    pub(super) fn uses_fifos(&self) -> bool {
        self.user_io == USER_IO_FIFOS
    }

    /// Starts every run before waiting so mutually dependent processes cannot deadlock.
    pub fn evaluate(
        &self,
        job: &EvaluationJob,
        toolchain: &dyn Toolchain,
        runtime: &Runtime,
        store: Box<dyn Cache>,
    ) -> Result<Verdict, TaskError> {
        let (executable, digest) = one_executable(job)?;
        let manager = manager_digest(job)?;
        let shared = boxes::Shared::of(store);
        let pipes = self.pipes(runtime)?;
        let mut manager_run = boxes::manager_of(runtime, &shared, job, &manager)?;
        let mut runs = boxes::users_of(runtime, self.num_processes, &shared, &executable, &digest)?;
        let first = self.start_manager(&mut manager_run, job, runtime, &pipes)?;
        let rest = self.start_users(&mut runs, job, toolchain, runtime, &pipes, &executable)?;
        let (manager_stats, user_stats) = launch::drain_all(first, rest)?;
        let mut verdict = self.judge(&manager_run, job, manager_stats, user_stats)?;
        let keep = job.archive_sandbox || !verdict.success;
        for closed in boxes::close(manager_run, runs, keep, job.archive_sandbox)? {
            closed.record(&mut verdict.sandboxes, &mut verdict.sandbox_digests);
        }
        pipes::close(&pipes, keep)?;
        Ok(verdict)
    }

    fn pipes(&self, runtime: &Runtime) -> Result<Vec<Pipe>, TaskError> {
        (0..self.num_processes)
            .map(|index| Pipe::open(runtime.temp_dir(), index))
            .collect()
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

/// The manager a run is started with, which the dataset has to hold.
fn manager_digest(job: &EvaluationJob) -> Result<String, TaskError> {
    job.managers
        .get(MANAGER)
        .cloned()
        .ok_or_else(|| TaskError::MissingManager {
            name: MANAGER.to_owned(),
        })
}
