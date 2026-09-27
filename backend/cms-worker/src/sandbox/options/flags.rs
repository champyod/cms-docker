//! The arguments a run is launched with, and the order they are read in.
//!
//! [`Options`] says what a run is allowed to do; this says what that looks like on
//! a command line. Nothing here decides anything — it renders the options a caller
//! already set into the words the isolation program reads, in the reference's
//! order, and the isolation program is the only thing that enforces any of it.
//!
//! The rendering is separate from the options for one reason: an option is a value
//! a caller can hold and change, while an argument is a string that only exists for
//! the length of one launch. Keeping them apart means the flag names and the unit
//! every limit is written in are all in one place, and adding an option is adding a
//! value rather than touching every flag writer.
//!
//! Every list here is an argument list rather than a line of shell, and is handed to
//! a [`Command`] as it is: a program is started with the words it is given, not with
//! a string something else has to take apart again, so no word is quoted on the way
//! to a launch. A line meant for a person to read is the one exception, and it is
//! quoted word by word precisely so it says what the launch said.
//!
//! # Errors
//!
//! None. Every function here is a pure rendering of options a caller already holds,
//! so a run is refused for what it asked for rather than for how it was written
//! out. The only failure a launch can have is in starting it, which is not this
//! module's.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::borrow::Cow;
use std::path::Path;

use shell_escape::unix::escape;

use super::units::{kibibytes, seconds};
use super::{MappedDirectory, Options};

/// The flag that opens every run's argument list.
const FLAG_CG: &str = "--cg";
/// The flag that ends the isolation program's own options and starts the run's.
const OPTION_END: &str = "--";
/// The flag that makes every later flag apply to a run.
const FLAG_RUN: &str = "--run";
/// The flag that makes a run print what it is doing, once per repetition.
const FLAG_VERBOSE: &str = "--verbose";
/// The flag that runs a box with the whole environment rather than an empty one.
const FLAG_FULL_ENV: &str = "--full-env";
/// The flag naming one variable of the environment, and what it is set to.
const FLAG_ENV: &str = "--env";

impl MappedDirectory {
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

    /// The same command line as one line a person can read and paste into a shell.
    ///
    /// This is the only place a word is escaped, and it is escaped because a line
    /// someone copies is taken apart again by a shell rather than by a program: a
    /// word holding a space or a quote has to survive being read back, or the line
    /// says something other than what the launch said. A launch is handed
    /// [`Self::invocation`] itself and is never escaped.
    #[must_use]
    pub fn display(&self, meta: &Path, command: &[&str]) -> String {
        let words = self.invocation(meta, command);
        words
            .iter()
            .map(|word| escape(Cow::Borrowed(word.as_str())))
            .collect::<Vec<Cow<'_, str>>>()
            .join(" ")
    }

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
