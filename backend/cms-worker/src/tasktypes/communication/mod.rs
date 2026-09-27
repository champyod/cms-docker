//! The Communication task type: a manager, the submission beside it, and the
//! named pipes they talk through.
//!
//! The three parameters are read for what they name. The first is how many
//! processes the submission runs as, and each gets a box and a pair of pipes of its
//! own. The second says whether the submission was compiled with the stub the
//! dataset holds, which is the name a run is judged by where the language names
//! one. The third says whether a process is told where its pipes are as arguments,
//! or has the pipes as its standard input and output instead.
//!
//! The order is the reference's and the only one that works: the boxes are made and
//! handed their files, the manager is started, every process is started, and only
//! then is any of them waited for. Each of those is one module's whole subject —
//! [`boxes`] makes a box and hands it its files, [`pipes`] makes the pipes a box is
//! told to make visible, [`launch`] starts every run and then reads them all back,
//! [`charge`] merges what the processes were charged, and [`verdict`] reads what
//! that and the manager's own two streams are worth.
//!
//! Two numbers the reference takes from the operator's configuration are not taken
//! from it here, because this worker holds no configuration: the manager is given
//! `processes × (time limit + 1 second)` rather than that with the operator's own
//! floor under it, and no memory bound at all, so it stands under the box's own
//! default. Every other number is the reference's, and both are said where they are
//! used.
//!
//! # Errors
//!
//! [`TaskError`], and only that: parameters that are not the three a
//! Communication task has, a result holding a number of executables other than
//! one, a dataset holding no manager of the name a run is started with, a limit
//! set to a number that bounds nothing, a pipe that could not be made, a file the
//! store would not hand over, and a run the box could not carry or read back.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

mod boxes;
mod charge;
mod launch;
mod manager;
mod pipes;
mod verdict;

use serde_json::Value;

use crate::job::EvaluationJob;
use crate::stage::Cache;

use self::pipes::Pipe;
pub use self::verdict::Verdict;
use super::batch::TaskError;
use super::Runtime;
use super::Toolchain;

/// The manager the dataset holds, the input it reads, and the file it may write
/// for a user test to be shown.
const MANAGER: &str = "manager";
const INPUT: &str = "input.txt";
const OUTPUT: &str = "output.txt";
/// The basename of the stub, which is the main class in the languages that name one
/// separately from the executable holding it, and the choice that compiles a
/// submission with it.
const STUB: &str = "stub";
const COMPILATION_STUB: &str = "stub";
/// The choice that tells a process where its pipes are as arguments.
const USER_IO_FIFOS: &str = "fifo_io";
const EXECUTABLES_REQUIRED: usize = 1;
/// The score of a run that did not answer and of a job that only asked to be run:
/// both are zero, and what a report shows is what says so.
const NO_CREDIT: f64 = 0.0;
const EXECUTED: &str = "Execution completed successfully";

/// The Communication task type, as its three parameters say.
///
/// A count of none is refused, as the reference's own merge refuses the figures of
/// no process at all.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Communication {
    num_processes: usize,
    compilation: String,
    user_io: String,
}

impl Communication {
    /// Reads the three parameters a Communication task type is configured with: the
    /// number of processes the submission runs as, the compilation choice, and the
    /// user I/O choice, in that order.
    ///
    /// # Errors
    ///
    /// [`TaskError::Parameters`] unless the parameters hold exactly those three and
    /// the first is a positive count.
    pub fn new(parameters: &Value) -> Result<Self, TaskError> {
        let entries = parameters.as_array().ok_or(TaskError::Parameters)?;
        let [num_processes, compilation, user_io] = entries.as_slice() else {
            return Err(TaskError::Parameters);
        };
        let count = num_processes
            .as_u64()
            .and_then(|count| usize::try_from(count).ok())
            .filter(|count| *count > 0)
            .ok_or(TaskError::Parameters)?;
        Ok(Self {
            num_processes: count,
            compilation: text_of(compilation)?,
            user_io: text_of(user_io)?,
        })
    }

    /// How many processes the submission runs as, and so how many pairs of pipes an
    /// evaluation makes and how many boxes it opens.
    #[must_use]
    pub fn processes(&self) -> usize {
        self.num_processes
    }

    /// Whether the submission was compiled together with the stub.
    pub(super) fn uses_stub(&self) -> bool {
        self.compilation == COMPILATION_STUB
    }

    /// Whether a process is told where its pipes are as arguments, rather than
    /// having the pipes as its standard input and output.
    pub(super) fn uses_fifos(&self) -> bool {
        self.user_io == USER_IO_FIFOS
    }

    /// Evaluates one submission on one testcase, in the reference's order: the boxes
    /// and their files, then every run started, then every run read back, then what
    /// the answers are worth.
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
        verdict.sandboxes = boxes::close(manager_run, runs, keep)?;
        pipes::close(&pipes, keep)?;
        Ok(verdict)
    }

    /// One pair of pipes per process, made before a box is made, since a box is
    /// handed the pair as a directory to make visible and a directory that is not
    /// there cannot be made visible.
    fn pipes(&self, runtime: &Runtime) -> Result<Vec<Pipe>, TaskError> {
        (0..self.num_processes)
            .map(|index| Pipe::open(runtime.temp_dir(), index))
            .collect()
    }
}

/// The one executable a result holds, which is the count the reference checks
/// before anything is made, and the name and digest of the one that is there.
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

/// One parameter read as the string it has to be.
fn text_of(entry: &Value) -> Result<String, TaskError> {
    entry
        .as_str()
        .map(str::to_owned)
        .ok_or(TaskError::Parameters)
}
