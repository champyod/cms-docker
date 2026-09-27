//! The arguments a run is launched with, and the directory mapping each becomes.
//!
//! [`Options`] says what a run is allowed to do; this says what that looks like on
//! a command line. Nothing here decides anything — it renders the options a caller
//! already set into the words the isolation program reads, in the reference's
//! order, and the isolation program is the only thing that enforces any of it.
//!
//! The rendering is separate from the options for one reason: an option is a value
//! a caller can hold and change, while an argument is a string that only exists for
//! the length of one launch. Keeping them apart means the flag names, the kibibyte
//! conversions and the unit the isolation program takes are all in one place, and
//! adding an option is adding a value rather than touching every flag writer.
//!
//! Two conversions happen here rather than at the call site, because the isolation
//! program and the log disagree with the caller about units. Every size is given
//! in bytes and written in kibibytes, and every limit is given as a duration and
//! written in seconds with its fraction kept, because that is what the two sides
//! take them in.
//!
//! # Errors
//!
//! None. Every function here is a pure rendering of options a caller already holds,
//! so a run is refused for what it asked for rather than for how it was written
//! out. The only failure a launch can have is in starting it, which is not this
//! module's.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::path::{Path, PathBuf};
use std::time::Duration;

use super::Options;

/// Bytes in the kibibytes the isolation program takes every size in.
const BYTES_PER_KIBIBYTE: u64 = 1024;
/// The flag that runs a box with the whole environment rather than an empty one.
const FLAG_FULL_ENV: &str = "--full-env";
/// The flag naming one variable of the environment, and what it is set to.
const FLAG_ENV: &str = "--env";

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

    /// The mapping as one `--dir` argument: destination, then source, then rules.
    #[must_use]
    pub fn argument(&self) -> String {
        let mut argument = self.destination.clone();
        if let Some(source) = &self.source {
            argument.push('=');
            argument.push_str(&source.display().to_string());
        }
        if let Some(options) = &self.options {
            argument.push(':');
            argument.push_str(options);
        }
        argument
    }
}

impl Options {
    /// The `--dir` flags for every directory the box is told to make visible.
    pub(super) fn directory_flags(&self) -> Vec<String> {
        self.directories
            .iter()
            .map(|directory| format!("--dir={}", directory.argument()))
            .collect()
    }

    /// The environment flags, in the order the isolation program applies them: the
    /// whole environment first if it was asked for, then each inherited variable,
    /// then each variable the run is told the value of.
    pub(super) fn environment_flags(&self) -> Vec<String> {
        let mut flags = Vec::new();
        if self.full_environment {
            flags.push(FLAG_FULL_ENV.to_owned());
        }
        flags.extend(
            self.inherited_variables
                .iter()
                .map(|name| format!("{FLAG_ENV}={name}")),
        );
        flags.extend(
            self.assigned_variables
                .iter()
                .map(|(name, value)| format!("{FLAG_ENV}={name}={value}")),
        );
        flags
    }

    /// The size flags, each written in the kibibytes the isolation program takes.
    pub(super) fn size_flags(&self) -> Vec<String> {
        let mut flags = Vec::new();
        if let Some(size) = self.file_size {
            flags.push(format!("--fsize={}", kibibytes(size)));
        }
        if let Some(size) = self.stack_size {
            flags.push(format!("--stack={}", kibibytes(size)));
        }
        if let Some(size) = self.address_space {
            flags.push(format!("--cg-mem={}", kibibytes(size)));
        }
        flags
    }

    /// The three stream flags, in the order the isolation program applies them.
    pub(super) fn stream_flags(&self) -> Vec<String> {
        let mut flags = Vec::new();
        if let Some(file) = &self.stdin_file {
            flags.push(self.inner_path_flag("--stdin", file));
        }
        if let Some(file) = &self.stdout_file {
            flags.push(self.inner_path_flag("--stdout", file));
        }
        if let Some(file) = &self.stderr_file {
            flags.push(self.inner_path_flag("--stderr", file));
        }
        flags
    }

    /// The isolation program permits one process unless told otherwise, so a run
    /// given no number of its own is told it may have as many as it likes.
    pub(super) fn processes_flag(&self) -> String {
        self.max_processes.map_or_else(
            || "--processes".to_owned(),
            |allowed| format!("--processes={allowed}"),
        )
    }

    /// The three time limits, each written in the seconds the isolation program takes.
    pub(super) fn timeout_flags(&self) -> Vec<String> {
        let mut flags = Vec::new();
        if let Some(limit) = self.cpu_time {
            flags.push(format!("--time={}", seconds(limit)));
        }
        if let Some(limit) = self.wall_clock_timeout {
            flags.push(format!("--wall-time={}", seconds(limit)));
        }
        if let Some(limit) = self.extra_time {
            flags.push(format!("--extra-time={}", seconds(limit)));
        }
        flags
    }

    /// A file a run reads or writes, named the way the run itself sees it: an
    /// absolute path is already the run's own, and a relative one is inside the
    /// directory the run was given.
    fn inner_path_flag(&self, flag: &str, file: &Path) -> String {
        let path = file.display().to_string();
        if path.starts_with('/') {
            return format!("{flag}={path}");
        }
        format!("{flag}={home}/{path}", home = self.working_directory)
    }
}

/// A size in bytes as the kibibytes the isolation program takes it in.
const fn kibibytes(size: u64) -> u64 {
    size / BYTES_PER_KIBIBYTE
}

/// A limit as the seconds the isolation program takes it in, fractions kept.
const fn seconds(limit: Duration) -> f64 {
    limit.as_secs_f64()
}
