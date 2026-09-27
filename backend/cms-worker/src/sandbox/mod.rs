//! Launching a run, and the answer the launch itself is worth.
//!
//! A worker decides nothing about a run; it asks the isolation program to do the
//! run and reads what that program reports. [`Sandbox`] is that one question:
//! [`Sandbox::run`] hands a command to the isolation program, waits for it, and
//! answers with the run's figures, why it ended and what it printed. Nothing here
//! grades, schedules or stores — the isolation program owns every one of those.
//!
//! The launch is faithful in four ways, each of which is a way a run could
//! otherwise be measured wrongly.
//!
//! Both pipes are drained while the run is alive. A run that prints more than a
//! pipe buffer holds would otherwise block on the write and never finish, so each
//! pipe is emptied by a thread of its own for as long as the run lasts and is
//! read to its end before the launch returns. Reading them in turn instead would
//! deadlock on whichever pipe filled first.
//!
//! Every limit is the isolation program's to enforce, so a CPU time, a wall clock
//! and the extra time a stop costs it are options rather than clocks this side
//! keeps. [`Options`] is where they are said, and a wall-clock stop is told apart
//! from a CPU one by the message the run's log wrote, not by guessing.
//!
//! Four commands run without the isolation program at all — copying into the box,
//! moving inside it, packing it and unpacking it — because they create files the
//! box has to be able to see and they read nothing a contestant wrote.
//! [`Sandbox::is_secure_command`] is the whole of that rule. Their output is not
//! forwarded: a run that sets a box up is not a run a contestant is shown, and its
//! error output is not theirs to read. Each leaves an empty log behind instead,
//! which is what a command that measured nothing looks like.
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

mod exits;
mod options;
mod spawn;

use std::fmt;
use std::io;
use std::path::{Path, PathBuf};

pub use exits::Outcome;
pub use options::{MappedDirectory, Options};
pub use spawn::{ReadError, Stream};

use crate::measure::{ExecutionLog, MeasureError};
use crate::stats::ExecutionStats;

/// The program a run is launched under, whatever an operator configured.
pub const EXECUTABLE_NAME: &str = "isolate";
/// The flag that ends the isolation program's own options and starts the run's.
const OPTION_END: &str = "--";
/// The path a run sees its own directory at, and the only place it may write.
pub const HOME_DESTINATION: &str = "/tmp";
/// A private directory the run's own user and group may share, on shared memory.
const SHARED_MEMORY_DESTINATION: &str = "/dev/shm";
/// The name a box's directory is given before its own unique suffix.
const OUTER_DIRECTORY_PREFIX: &str = "cms-sandbox-";
/// The prefix of the file one run's measurements are written to.
const META_PREFIX: &str = "run.log";
/// The commands run beside the isolation program rather than inside it.
///
/// They create files the run has to see, and they read nothing a contestant wrote,
/// which is what makes running them unsandboxed safe.
pub const SECURE_COMMANDS: [&str; 4] = ["/bin/cp", "/bin/mv", "/usr/bin/zip", "/usr/bin/unzip"];

/// The outer directory, the run's own directory inside it, and the program.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Layout {
    outer: PathBuf,
    home: PathBuf,
    executable: PathBuf,
}

impl Layout {
    /// A layout under a caller-named directory, holding a run's own directory.
    fn create(temp_dir: &Path, name: &str, executable: &Path) -> io::Result<Self> {
        let outer = temp_dir.join(format!("{OUTER_DIRECTORY_PREFIX}{name}"));
        let home = outer.join("home");
        std::fs::create_dir_all(&home)?;
        Ok(Self {
            outer,
            home,
            executable: executable.to_path_buf(),
        })
    }

    /// The file the run numbered `number` has its measurements written to.
    fn meta_file(&self, number: u32) -> PathBuf {
        self.outer.join(format!("{META_PREFIX}.{number}"))
    }
}

/// Why a run was never launched, or was launched and could not be read back.
///
/// Every variant names the path or the program to look at, so a refusal names the
/// run rather than reporting that something did not work.
#[derive(Debug)]
pub enum SpawnError {
    /// A command was handed with nothing in it to run.
    EmptyCommand,
    /// The command's own name is the empty string, which names no program.
    NamelessCommand,
    /// The isolation program, or a command run in its place, would not start.
    Unlaunchable {
        /// The program that would not start.
        program: PathBuf,
        /// What starting it was refused with.
        source: io::Error,
    },
    /// A run finished and left no log behind, so nothing measured it.
    NoMetaFile {
        /// Where the log was to have been written.
        path: PathBuf,
    },
    /// The launch returned a code nothing here reads: either the isolation program
    /// failed in a way it does not document, or a command run beside it did not do
    /// what it was asked to. The box is not set up either way.
    Exit {
        /// The program that returned the code.
        program: String,
        /// The code it returned.
        code: i32,
    },
    /// A launch had to touch the run's own directory and could not.
    Io {
        /// The path the launch was working on.
        path: PathBuf,
        /// What the file system refused it with.
        source: io::Error,
    },
    /// A pipe carrying what a run printed could not be read to its end.
    Pipe(ReadError),
    /// A log held a value that is not the number its key promises.
    Measure(MeasureError),
}

impl fmt::Display for SpawnError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyCommand => write!(f, "the command to run is empty"),
            Self::NamelessCommand => write!(f, "the command to run has no program in it"),
            Self::Unlaunchable { program, source } => {
                write!(f, "cannot start {}: {source}", program.display())
            }
            Self::NoMetaFile { path } => write!(f, "the run wrote no log at {}", path.display()),
            Self::Exit { program, code } => {
                write!(f, "{program} returned an exit status ({code}) unknown")
            }
            Self::Io { path, source } => write!(f, "{source} at {}", path.display()),
            Self::Pipe(error) => write!(f, "{error}"),
            Self::Measure(error) => write!(f, "{error}"),
        }
    }
}

impl std::error::Error for SpawnError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Unlaunchable { source, .. } | Self::Io { source, .. } => Some(source),
            Self::Pipe(error) => Some(error),
            Self::Measure(error) => Some(error),
            Self::EmptyCommand
            | Self::NamelessCommand
            | Self::NoMetaFile { .. }
            | Self::Exit { .. } => None,
        }
    }
}

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
        let mut launch = vec![self.layout.executable.display().to_string()];
        launch.extend(
            self.options
                .arguments(&self.layout.meta_file(self.executions)),
        );
        launch.push(OPTION_END.to_owned());
        launch.extend(command.iter().map(|word| (*word).to_owned()));
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
