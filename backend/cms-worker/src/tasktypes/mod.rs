//! What a task type does with one job: the files it is handed, the runs it makes,
//! and what those runs are worth.
//!
//! A task type is the part of a worker that knows what a task *is*. Everything it
//! needs from the machine is already here — [`crate::sandbox`] launches a run and
//! reads back what it left behind, [`crate::stage`] hands it files and takes them
//! away again — so a task type is the order those two are used in and nothing
//! else. That order is the task type's own, and it is what differs between one
//! task type and the next.
//!
//! [`Batch`] is the one for a submission that is a single program judged by what
//! it prints, compiled either by itself or together with a grader the dataset
//! holds. It is two phases, each a flat run of early returns in the order the
//! reference does the work: `Batch::compile` stages the sources and the managers
//! the language reads, runs the compilation commands and collects the
//! executable; `Batch::evaluate` stages the executable and the input, runs it
//! under the dataset's limits, and maps what came back to an outcome.
//!
//! Three things are the caller's, because none of them is a task type's business.
//! The language a job names is a [`Toolchain`], and the lookup that produced it
//! lives with the languages the worker was configured with. Where a box is made
//! and what a compilation is held to is a [`Runtime`]. The store the files come
//! from and go to is a [`Cache`], which a phase is handed rather than looks up.
//! All three answer in values and never in lookups, so a task type can be
//! exercised without a machine.
//!
//! # Errors
//!
//! [`TaskError`], and only that: parameters that are not the three a Batch task
//! has, a dataset holding no grader manager a grader compilation needs, a
//! submission carrying too few files, a result carrying the wrong number of
//! executables, a limit a dataset set that is not a positive number, a file the
//! store would not hand over, and a run the box could not carry or read back.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

mod batch;
mod compile;
mod evaluate;

use std::fs;
use std::path::PathBuf;
use std::str::FromStr;
use std::time::Duration;

pub use batch::{Batch, TaskError};
pub use compile::Compilation;
pub use evaluate::{Evaluation, OutputFile};

use crate::sandbox::{Options, Sandbox};
use crate::stage::{Cache, CacheHandle, FileDigest, Stage, StageError};
use crate::stats::ExecutionStats;

/// How many times a CPU limit is charged against the wall clock a run must finish
/// inside, because a run that is stopped is still charged for being stopped.
const WALL_CLOCK_MULTIPLIER: u32 = 2;
/// What stopping a run costs it on top of its own limit, in seconds.
const WALL_CLOCK_GRACE: Duration = Duration::from_secs(1);

/// One programming language, as a compilation and an evaluation each need it.
///
/// The lookup that turns the name a job carries into one of these is the
/// caller's, and lives with the languages the worker was configured with: a name
/// it does not know is refused there, as it is in
/// [`crate::job::BuildError::UnknownLanguage`].
pub trait Toolchain {
    /// The extension a source file of this language has, which is what
    /// `grader.%l` becomes and what a submitted codename is rewritten to.
    fn source_extension(&self) -> &str;

    /// The extension an executable of this language has, appended to the name
    /// the task type chose for it. Empty for a language that tells its
    /// executables apart by nothing else.
    fn executable_extension(&self) -> &str;

    /// Whether a manager is one this language's compilation reads: a source, a
    /// header or an object extension it names, and nothing else.
    fn compiles_against(&self, manager: &str) -> bool;

    /// The commands that compile `sources` into `executable`.
    ///
    /// The first source is the one holding the entry point, which is the order
    /// some languages need, and the commands run in the order they are given.
    fn compilation_commands(&self, sources: &[String], executable: &str) -> Vec<Vec<String>>;

    /// The commands that run `executable`, judged by `main` where a language
    /// names its main class or module separately from the executable holding it.
    fn evaluation_commands(&self, executable: &str, main: &str) -> Vec<Vec<String>>;
}

/// The three numbers a compilation is held to.
///
/// They are configuration rather than a task type's business, and a limit the
/// operator set to none is sent as no limit at all, so the box's own default
/// stands.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct CompilationLimits {
    /// The CPU time a compilation is charged, in seconds.
    pub time: Option<Duration>,
    /// The memory a compilation may address, in bytes.
    pub memory: Option<u64>,
    /// How many processes a compilation may have alive at once.
    pub processes: Option<u32>,
}

/// Where a box is made, what a compilation is held to and how large a file an
/// evaluation may create: the settings every run of this worker carries before a
/// task type changes anything.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Runtime {
    program: PathBuf,
    temp_dir: PathBuf,
    /// The three numbers a compilation is held to.
    pub compilation: CompilationLimits,
    /// The largest file an evaluation may create, in bytes, or `None` for a file
    /// as large as the machine allows. It bounds the box rather than a testcase,
    /// so it is the same size for every evaluation run this worker makes, and a
    /// compilation is not held to it.
    pub file_size: Option<u64>,
}

impl Runtime {
    /// A runtime whose boxes are made under `temp_dir`, whose runs are launched
    /// under the isolation program at `program`, and whose evaluation runs may
    /// create a file of `file_size` bytes.
    #[must_use]
    pub fn new(
        program: impl Into<PathBuf>,
        temp_dir: impl Into<PathBuf>,
        compilation: CompilationLimits,
        file_size: Option<u64>,
    ) -> Self {
        Self {
            program: program.into(),
            temp_dir: temp_dir.into(),
            compilation,
            file_size,
        }
    }

    /// A box named `name` and the files it is handed, over one directory.
    fn open(&self, name: &str, store: Box<dyn Cache>) -> Result<Run, TaskError> {
        let sandbox =
            Sandbox::new(&self.program, &self.temp_dir, name).map_err(TaskError::Spawn)?;
        let files = Stage::at(sandbox.home(), store).map_err(TaskError::Stage)?;
        Ok(Run { sandbox, files })
    }
}

/// One run's box and the files it is handed, over a single directory.
///
/// The two halves are the same directory: the box launches the run inside it and
/// the stage is what the run finds there.
struct Run {
    sandbox: Sandbox,
    files: Stage,
}

impl Run {
    fn sandbox(&mut self) -> &mut Sandbox {
        &mut self.sandbox
    }

    fn files(&self) -> &Stage {
        &self.files
    }

    /// Launches one command under `options` and answers with what it was charged.
    fn launch(
        &mut self,
        command: &[String],
        options: &Options,
    ) -> Result<ExecutionStats, TaskError> {
        self.sandbox.set_options(options.clone());
        let words: Vec<&str> = command.iter().map(String::as_str).collect();
        self.sandbox.run(&words).map_err(TaskError::Spawn)
    }

    /// Finishes the run: keeps the box where `keep` asks for it and removes it
    /// otherwise, answering with the path the report names the box by either way.
    fn close(self, keep: bool) -> Result<PathBuf, TaskError> {
        let root = self.sandbox.outer().to_path_buf();
        if !keep {
            if let Err(source) = fs::remove_dir_all(&root) {
                return Err(TaskError::Stage(StageError::io(&root, &source)));
            }
        }
        Ok(root)
    }
}

/// The clock a run charged this CPU time must finish inside: twice the limit
/// plus a second, since stopping a run is not instant.
pub(super) fn wall_clock_of(cpu_time: Duration) -> Duration {
    cpu_time * WALL_CLOCK_MULTIPLIER + WALL_CLOCK_GRACE
}

/// A handle for a digest a job carries, which the store is asked for by.
pub(super) fn handle(digest: &str) -> Result<CacheHandle, TaskError> {
    let digest = FileDigest::from_str(digest)
        .map_err(|error| TaskError::Stage(StageError::Digest(error)))?;
    Ok(CacheHandle::new(digest))
}
