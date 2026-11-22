//! Where a box is made, and the files one run is handed: the half of a task type that
//! touches the machine.
//!
//! A [`Runtime`] is the settings every run of this worker carries before a task type
//! changes anything: the isolation program, the directory boxes are made under, what a
//! compilation is held to, how large an evaluation's file may be, and the numbers a
//! dataset's checker is held to. None of them is a task type's business, and all of them
//! are handed in rather than looked up, so a task type can be exercised without a
//! machine.
//!
//! A [`Run`] is one box and the files it is handed, over a single directory: the box
//! launches the run inside it and the stage is what the run finds there. A store one
//! run reads and a judging step must read again is [`Shared`], because a `Box` cannot be
//! handed to two owners and the reference passes one file cacher to every sandbox.
//!
//! # Errors
//!
//! [`TaskError`], and only that: a box that could not be made, a file that could not be
//! staged, a run that could not be launched or read back, and a directory that could not
//! be removed.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::stage::{Cache, CacheHandle, FileDigest, Stage, StageError};
use crate::steps::TrustedLimits;
use cms_sandbox::ExecutionStats;
use cms_sandbox::{Launch, Options, Sandbox};

use super::{CompilationLimits, TaskError};

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
    /// The numbers a dataset's checker is held to, which bound a manager rather than a
    /// submission and are the same for every check this worker makes.
    pub trusted: TrustedLimits,
}

impl Runtime {
    /// The directory a task type makes its own files in, which is where a box's
    /// files are and so where anything that belongs to a run beside a box goes.
    pub(super) fn temp_dir(&self) -> &Path {
        &self.temp_dir
    }

    /// A runtime whose boxes are made under `temp_dir`, whose runs are launched
    /// under the isolation program at `program`, whose evaluation runs may
    /// create a file of `file_size` bytes, and whose checkers are held to `trusted`.
    #[must_use]
    pub fn new(
        program: impl Into<PathBuf>,
        temp_dir: impl Into<PathBuf>,
        compilation: CompilationLimits,
        file_size: Option<u64>,
        trusted: TrustedLimits,
    ) -> Self {
        Self {
            program: program.into(),
            temp_dir: temp_dir.into(),
            compilation,
            file_size,
            trusted,
        }
    }

    /// A box named `name` and the files it is handed, over one directory, which the
    /// store is handed to rather than shared.
    pub(super) fn open(&self, name: &str, store: Box<dyn Cache>) -> Result<Run, TaskError> {
        self.open_shared(name, Arc::from(store))
    }

    /// A box named `name` and the files it is handed over a store several boxes read:
    /// a judging step makes a second box while the run's own is still open, and one
    /// store cannot be handed to two owners.
    pub(super) fn open_shared(&self, name: &str, store: Arc<dyn Cache>) -> Result<Run, TaskError> {
        let sandbox =
            Sandbox::new(&self.program, &self.temp_dir, name).map_err(TaskError::Spawn)?;
        let files = Stage::at(sandbox.home(), Box::new(Shared(store))).map_err(TaskError::Stage)?;
        Ok(Run { sandbox, files })
    }
}

/// One store every box of an evaluation reads, handed out as a box of its own.
///
/// The reference passes its file cacher to every sandbox it creates, and a `Box`
/// cannot be handed to two, so the store is shared behind a handle and each box is
/// handed one.
#[derive(Clone)]
pub(crate) struct Shared(Arc<dyn Cache>);

impl Shared {
    /// The store the caller handed over, shared rather than split.
    pub(super) fn of(store: impl Into<Arc<dyn Cache>>) -> Self {
        Self(store.into())
    }

    /// The store as a handle, which is what a box opened over it is given.
    pub(super) fn arc(&self) -> Arc<dyn Cache> {
        Arc::clone(&self.0)
    }
}

impl Cache for Shared {
    fn get_file(&self, handle: &CacheHandle) -> Result<Vec<u8>, StageError> {
        self.0.get_file(handle)
    }

    fn put_file(&self, digest: &FileDigest, content: &[u8]) -> Result<bool, StageError> {
        self.0.put_file(digest, content)
    }
}

/// One run's box and the files it is handed, over a single directory.
///
/// The two halves are the same directory: the box launches the run inside it and
/// the stage is what the run finds there.
pub(crate) struct Run {
    sandbox: Sandbox,
    files: Stage,
}

impl Run {
    pub(super) fn sandbox(&mut self) -> &mut Sandbox {
        &mut self.sandbox
    }

    /// The box and the files it is handed, together, for a step that launches in the
    /// box and stages from the same directory at once.
    pub(super) fn parts(&mut self) -> (&mut Sandbox, &Stage) {
        (&mut self.sandbox, &self.files)
    }

    pub(super) fn files(&self) -> &Stage {
        &self.files
    }

    /// Starts one command under `options` and hands the run back, still running,
    /// for a task type that must start every one of its runs before it waits for
    /// any of them, which is the only order in which two runs that have to talk to
    /// each other can both make progress.
    pub(super) fn started(
        &mut self,
        words: &[&str],
        options: &Options,
    ) -> Result<Launch, TaskError> {
        self.sandbox.set_options(options.clone());
        self.sandbox.start(words).map_err(TaskError::Spawn)
    }

    /// Launches one command under `options` and answers with what it was charged.
    pub(super) fn launch(
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
    pub(super) fn close(self, keep: bool) -> Result<PathBuf, TaskError> {
        let root = self.sandbox.outer().to_path_buf();
        if !keep {
            if let Err(source) = fs::remove_dir_all(&root) {
                return Err(TaskError::Stage(StageError::io(&root, &source)));
            }
        }
        Ok(root)
    }
}
