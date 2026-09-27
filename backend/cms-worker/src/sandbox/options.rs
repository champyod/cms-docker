//! What every run of a box is told: the flags, the limits and the log's name.
//!
//! Everything a run is allowed to do is said here as flags, and the isolation
//! program is the only thing that enforces any of it. Nothing on this side keeps a
//! clock or counts a process: a run is bounded by the numbers it was launched with,
//! and a limit measured here would be a second answer to a question the isolation
//! program has already answered.
//!
//! The flags are written in the reference's order, so the command line a run is
//! launched with is the one that was read off it. `--cg` comes first because it
//! selects the keys the log is written in, and `--meta` and `--run` come last
//! because everything between them configures a run rather than the box.
//!
//! Three of the numbers are limits, and each is a watchdog the isolation program
//! holds rather than one held here: `cpu_time` is the time a run is charged,
//! `wall_clock_timeout` is the clock it must finish inside, and `extra_time` is
//! what a stop costs it, since killing a run is not instant. The first two are the
//! two answers [`ExitStatus::Timeout`] and [`ExitStatus::TimeoutWall`] are told
//! apart by, and only the log ever says which one ran out.
//!
//! The sizes are given in bytes and written in kibibytes, because that is the unit
//! the isolation program takes them in and the unit the log reports memory in. A
//! limit the caller never set is sent as no flag at all, so the box's own default
//! stands — except for the processes, where the isolation program's default is one
//! process and a run that is meant to fork has to be told so.
//!
//! [`ExitStatus::Timeout`]: crate::ExitStatus::Timeout
//! [`ExitStatus::TimeoutWall`]: crate::ExitStatus::TimeoutWall

#![deny(missing_docs)]
#![forbid(unsafe_code)]

mod flags;

use std::path::{Path, PathBuf};
use std::time::Duration;

pub use flags::MappedDirectory;

use super::{HOME_DESTINATION, SHARED_MEMORY_DESTINATION};

/// The flag that opens every run's argument list.
const FLAG_CG: &str = "--cg";
/// The flag that ends the box's own options and starts the run's own.
const OPTION_END: &str = "--";
/// The flag that makes every later flag apply to a run.
const FLAG_RUN: &str = "--run";
/// The flag that makes a run print what it is doing, once per repetition.
const FLAG_VERBOSE: &str = "--verbose";
/// The rule that lets a run write in a directory it is given.
const RULE_READ_WRITE: &str = "rw";
/// The rule that gives a run a directory of its own, written from nothing.
const RULE_TEMPORARY: &str = "tmp";
/// The name of the variable every run is told its home is.
const HOME_VARIABLE: &str = "HOME";

/// What every run of a box is launched with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Options {
    /// The directory a run writes in, which is the one it is bound to.
    pub working_directory: String,
    /// The directories the box is told to make visible.
    pub directories: Vec<MappedDirectory>,
    /// Whether a run inherits the whole environment rather than an empty one.
    pub full_environment: bool,
    /// The variables of the environment a run inherits as they are.
    pub inherited_variables: Vec<String>,
    /// The variables a run is told, and what it is told they are.
    pub assigned_variables: Vec<(String, String)>,
    /// The largest file a run may create, in bytes.
    pub file_size: Option<u64>,
    /// The file a run reads its standard input from, on this side.
    pub stdin_file: Option<PathBuf>,
    /// The stack a run is given, in bytes.
    pub stack_size: Option<u64>,
    /// The memory a run may address, in bytes.
    pub address_space: Option<u64>,
    /// Where a run's standard output is written, on this side.
    pub stdout_file: Option<PathBuf>,
    /// Where a run's standard error is written, on this side.
    pub stderr_file: Option<PathBuf>,
    /// How many processes a run may have alive at once, or `None` for as many as it
    /// likes, which is not the isolation program's own default of one.
    pub max_processes: Option<u32>,
    /// The CPU time a run is charged, and past which it is stopped.
    pub cpu_time: Option<Duration>,
    /// The wall clock a run must finish inside.
    pub wall_clock_timeout: Option<Duration>,
    /// What a stop costs a run on top of its limit, since killing is not instant.
    pub extra_time: Option<Duration>,
    /// How many times a run is asked to say what it is doing.
    pub verbosity: u32,
}

impl Default for Options {
    /// The options a run is launched with when the caller said nothing about
    /// directories: it writes in its own directory, is told where its home is, and
    /// has no time and no memory of its own to be stopped for. A run launched this
    /// way is bounded only by the machine, so a caller that means to bound it says
    /// so.
    fn default() -> Self {
        Self {
            working_directory: HOME_DESTINATION.to_owned(),
            directories: Vec::new(),
            full_environment: false,
            inherited_variables: Vec::new(),
            assigned_variables: vec![(HOME_VARIABLE.to_owned(), HOME_DESTINATION.to_owned())],
            file_size: None,
            stdin_file: None,
            stack_size: None,
            address_space: None,
            stdout_file: None,
            stderr_file: None,
            max_processes: None,
            cpu_time: None,
            wall_clock_timeout: None,
            extra_time: None,
            verbosity: 0,
        }
    }
}

impl Options {
    /// The options a run of a box whose own directory is `home` is launched with:
    /// the two mappings every run needs, and the defaults beside them.
    ///
    /// The run's own directory is bound where the run expects to find itself, and
    /// shared memory is bound to a directory of its own so that two runs cannot
    /// leave anything for each other to read.
    #[must_use]
    pub fn for_sandbox(home: &Path) -> Self {
        Self {
            directories: vec![
                MappedDirectory::at(home, HOME_DESTINATION).with_options(RULE_READ_WRITE),
                MappedDirectory::at(SHARED_MEMORY_DESTINATION, SHARED_MEMORY_DESTINATION)
                    .with_options(RULE_TEMPORARY),
            ],
            ..Self::default()
        }
    }

    /// The flags this run of the box is launched with, in the reference's order.
    ///
    /// `meta` is the file this run's measurements are written to, so the last two
    /// flags name where to read them and make everything above them about a run.
    #[must_use]
    pub fn arguments(&self, meta: &Path) -> Vec<String> {
        let mut flags = vec![
            FLAG_CG.to_owned(),
            format!("--chdir={}", self.working_directory),
        ];
        flags.extend(self.directory_flags());
        flags.extend(self.environment_flags());
        flags.extend(self.size_flags());
        flags.extend(self.stream_flags());
        flags.push(self.processes_flag());
        flags.extend(self.timeout_flags());
        flags.extend(vec![FLAG_VERBOSE.to_owned(); self.verbosity as usize]);
        flags.push(format!("--meta={}", meta.display()));
        flags.push(FLAG_RUN.to_owned());
        flags
    }

    /// The whole command line a run is launched with, its own words included.
    #[must_use]
    pub fn invocation(&self, meta: &Path, command: &[&str]) -> Vec<String> {
        let mut flags = self.arguments(meta);
        flags.push(OPTION_END.to_owned());
        flags.extend(command.iter().map(|word| (*word).to_owned()));
        flags
    }
}
