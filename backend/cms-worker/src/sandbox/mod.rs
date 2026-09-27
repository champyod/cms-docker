//! Launching a run, and the answer the launch itself is worth.
//!
//! A worker decides nothing about a run; it asks the isolation program to do the
//! run and reads what that program reports. [`Sandbox`] is that one question:
//! [`Sandbox::run`] hands a command to the isolation program, waits for it, and
//! answers with the run's figures, why it ended and what it printed. Nothing here
//! grades, schedules or stores — the isolation program owns every one of those.
//!
//! The launch is faithful in four ways, each of which is a way a run could
//! otherwise be measured wrongly, and each is one module's whole subject.
//!
//! Both pipes are drained while the run is alive, by [`stream`], or a run that
//! prints more than a pipe holds would block on the write and never finish.
//!
//! Every limit is the isolation program's to enforce, so the CPU time, the wall
//! clock and what a stop costs are [`Options`] rather than clocks this side keeps.
//!
//! Four commands run without the isolation program at all, because they create
//! files the box has to see and read nothing a contestant wrote;
//! [`Sandbox::is_secure_command`] is the whole of that rule. Their output is not
//! forwarded, and each leaves an empty log behind instead.
//!
//! A code the run returned is not a verdict. [`Outcome`] is: `0` and `1` both mean
//! the isolation program itself worked, and only the run's log says what happened
//! inside it, so the codes it reports are read through [`ExecutionLog`] into the
//! one [`ExitStatus`] a report shows. A code outside those three is not a run at
//! all, and is refused rather than guessed at.
//!
//! # Errors
//!
//! [`SpawnError`], and nothing else: a command with nothing in it, a program that
//! cannot be started, a log no run wrote, a pipe that could not be read, and a
//! number a log holds and cannot read. A run that failed, was stopped or was
//! killed is not an error — it is an answer a report is written from.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

mod error;
mod exits;
mod options;
mod spawn;
mod stream;

use std::fs;
use std::path::Path;
use std::process::Output;

pub use error::SpawnError;
pub use exits::Outcome;
pub use options::{MappedDirectory, Options};
pub use spawn::SECURE_COMMANDS;
pub use stream::{ReadError, Stream};

use spawn::Layout;

use crate::measure::ExecutionLog;
use crate::stats::ExecutionStats;

/// The program a run is launched under, whatever an operator configured.
pub const EXECUTABLE_NAME: &str = "isolate";
/// The path a run sees its own directory at, and the only place it may write.
pub const HOME_DESTINATION: &str = "/tmp";
/// A private directory the run's own user and group may share, on shared memory.
const SHARED_MEMORY_DESTINATION: &str = "/dev/shm";
/// The program a run is launched under, and the run's own directory beside it.
///
/// A sandbox is created over a directory and never initialised, torn down or told
/// which box to use: those are the isolation program's own lifecycle, and a worker
/// holding one of these holds nothing it would have to clean up.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sandbox {
    layout: Layout,
    options: Options,
    executions: u32,
}

impl Sandbox {
    /// A sandbox whose runs are launched under the program at `executable`, with
    /// their files in a directory of their own under `temp_dir`.
    ///
    /// The name only labels the directory, so a caller launching several sandboxes
    /// at once can tell their files apart while looking.
    /// # Errors
    /// [`SpawnError::Io`] when the run's own directory cannot be made.
    pub fn new(
        executable: impl AsRef<Path>,
        temp_dir: impl AsRef<Path>,
        name: &str,
    ) -> Result<Self, SpawnError> {
        let layout =
            Layout::create(temp_dir.as_ref(), name, executable.as_ref()).map_err(|source| {
                SpawnError::Io {
                    path: temp_dir.as_ref().to_path_buf(),
                    source,
                }
            })?;
        let options = Options::for_sandbox(&layout.home);
        Ok(Self::with_options(layout, options))
    }

    /// The isolation program this sandbox launches its runs under.
    #[must_use]
    pub fn executable(&self) -> &Path {
        &self.layout.executable
    }

    /// The run's own directory on this side, which is where its files are.
    #[must_use]
    pub fn home(&self) -> &Path {
        &self.layout.home
    }

    /// The outer directory, which is where a run's log is written.
    #[must_use]
    pub fn outer(&self) -> &Path {
        &self.layout.outer
    }

    /// How many runs this sandbox has launched.
    #[must_use]
    pub const fn executions(&self) -> u32 {
        self.executions
    }

    /// The options every run of this sandbox is launched with.
    #[must_use]
    pub const fn options(&self) -> &Options {
        &self.options
    }

    /// The options of this sandbox's runs, which a caller may change before the
    /// next one is launched.
    pub fn set_options(&mut self, options: Options) {
        self.options = options;
    }

    /// Launches one run and answers with what it left behind.
    ///
    /// The run's own directory is made writable for the launch and given back the
    /// permissions it had, so a run that creates files cannot lock the next one out
    /// of the directory they share. Both pipes are read to their end before this
    /// returns, so what the run printed is here and not stuck in a pipe.
    /// # Errors
    /// [`SpawnError`], and only that: the command or the program could not be
    /// started, the directory could not be prepared, a pipe could not be read, the
    /// run wrote no log, or a number in that log could not be read.
    pub fn run(&mut self, command: &[&str]) -> Result<ExecutionStats, SpawnError> {
        let program = self.program_for(command)?;
        let number = self.next_execution();
        let bypassed = Self::is_secure_command(command);
        let output = self.launch(&program, number, bypassed)?;
        let log = self.read_log(number)?;
        Self::finish(&output, &log)
    }

    /// The answer a launch is turned into, once its log has been read.
    /// # Errors
    /// [`SpawnError::Measure`] for a number the log cannot read, and nothing else.
    pub(super) fn finish(
        output: &Output,
        log: &ExecutionLog,
    ) -> Result<ExecutionStats, SpawnError> {
        Self::outcome(
            log,
            Some(String::from_utf8_lossy(&output.stdout).into_owned()),
            Some(String::from_utf8_lossy(&output.stderr).into_owned()),
        )
    }

    /// Reads the log of the run numbered `number`, which is where a run's own
    /// measurements are waiting.
    /// # Errors
    /// [`SpawnError::NoMetaFile`] when the run left no log behind or it could not
    /// be read, and [`SpawnError::Measure`] for a number it cannot be read as.
    fn read_log(&self, number: u32) -> Result<ExecutionLog, SpawnError> {
        let path = self.layout.meta_file(number);
        let text = fs::read_to_string(&path).map_err(|_| SpawnError::NoMetaFile { path })?;
        ExecutionLog::parse(&text).map_err(SpawnError::Measure)
    }

    /// Whether a command is one of the four run beside the isolation program.
    ///
    /// The whole of the rule: the name is the program, and it is the program that
    /// is compared, not how the command was written.
    #[must_use]
    pub fn is_secure_command(command: &[&str]) -> bool {
        let Some(program) = command.first() else {
            return false;
        };
        SECURE_COMMANDS.contains(program)
    }

    /// What one run's log and its own output add up to.
    /// # Errors
    /// [`SpawnError::Measure`] for a number the log cannot read, and nothing else.
    pub fn outcome(
        log: &ExecutionLog,
        stdout: Option<String>,
        stderr: Option<String>,
    ) -> Result<ExecutionStats, SpawnError> {
        let mut stats = ExecutionStats::of(log).map_err(SpawnError::Measure)?;
        stats.stdout = stdout;
        stats.stderr = stderr;
        Ok(stats)
    }

    /// The program that will carry this run: the isolation program, or the command
    /// itself when it is one of the four run beside it.
    fn program_for(&self, command: &[&str]) -> Result<Vec<String>, SpawnError> {
        let Some(program) = command.first() else {
            return Err(SpawnError::EmptyCommand);
        };
        if program.is_empty() {
            return Err(SpawnError::NamelessCommand);
        }
        if Self::is_secure_command(command) {
            return Ok(command.iter().map(|word| (*word).to_owned()).collect());
        }
        let meta = self.layout.meta_file(self.executions);
        let mut launch = vec![self.layout.executable.display().to_string()];
        launch.extend(self.options.invocation(&meta, command));
        Ok(launch)
    }

    /// Claims the number this run will be logged under, and holds it from now on
    /// so a run that is refused still leaves its number behind it.
    const fn next_execution(&mut self) -> u32 {
        self.executions += 1;
        self.executions - 1
    }

    const fn with_options(layout: Layout, options: Options) -> Self {
        Self {
            layout,
            options,
            executions: 0,
        }
    }
}
