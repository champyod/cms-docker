//! What every run of a box is told: the flags, the limits and the log's name.
//!
//! Everything a run is allowed to do is said here as flags, and the isolation
//! program is the only thing that enforces any of it. Nothing on this side keeps a
//! clock or counts a process: a run is bounded by the numbers it was launched
//! with, and a limit measured here would be a second answer to a question the
//! isolation program has already answered.
//!
//! What a run is allowed to do is a value a caller holds and changes, which is why
//! this module holds only the values; what those values look like on a command line
//! is [`flags`]'s whole subject, and the unit each limit is written in is
//! [`units`]'. A limit the caller never set is sent as no flag at all, so the box's
//! own default stands — except for the processes, where the isolation program's
//! default is one process and a run meant to fork has to be told so.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

mod flags;
mod units;

use std::path::{Path, PathBuf};
use std::time::Duration;

use super::{HOME_DESTINATION, SHARED_MEMORY_DESTINATION};

/// The rule that lets a run write in a directory it is given.
const RULE_READ_WRITE: &str = "rw";
/// The rule that gives a run a directory of its own, written from nothing.
const RULE_TEMPORARY: &str = "tmp";
/// The name of the variable every run is told its home is.
const HOME_VARIABLE: &str = "HOME";

/// A directory the box is told to make visible inside itself.
///
/// The source is the directory on this side and the destination is where the run
/// sees it, and a mapping with no source is bound to itself. The options are the
/// isolation program's own rule options — `rw`, `noexec`, `tmp` — and are written
/// after the source, which is the order it reads them in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MappedDirectory {
    /// The directory on this side, or `None` to bind the destination to itself.
    pub source: Option<PathBuf>,
    /// Where the run sees the directory.
    pub destination: String,
    /// The isolation program's rule options, or `None` for its own default.
    pub options: Option<String>,
}

impl MappedDirectory {
    /// A directory made visible where it already is.
    #[must_use]
    pub fn new(path: impl Into<String>) -> Self {
        Self {
            source: None,
            destination: path.into(),
            options: None,
        }
    }

    /// A directory on this side made visible under another name.
    #[must_use]
    pub fn at(source: impl Into<PathBuf>, destination: impl Into<String>) -> Self {
        Self {
            source: Some(source.into()),
            destination: destination.into(),
            options: None,
        }
    }

    /// The same mapping, with the isolation program's rule options set.
    #[must_use]
    pub fn with_options(mut self, options: impl Into<String>) -> Self {
        self.options = Some(options.into());
        self
    }
}

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
}
