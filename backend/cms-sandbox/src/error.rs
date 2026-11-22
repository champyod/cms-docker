//! Every way a run can be refused before it becomes a measurement.
//!
//! One type answers all of them, because a caller that launched a run has one
//! question — did it run, and if not why not — and eight different failure shapes
//! are one answer, not eight. Splitting them by origin would mean a caller had to
//! know whether a refusal came from the isolation program, from the file system or
//! from a log before it could match on it, and the point of an error is to be
//! matched on.
//!
//! What every variant does is name the thing to look at: the program that would not
//! start, the path a launch was working on, the code nothing here reads, or the
//! number a log could not be read as. A refusal that only said something did not
//! work would leave a caller with nothing to report and nothing to retry.
//!
//! Two of the eight are not about this side at all. A command that is empty names
//! no program to run, and a run that wrote no log measured nothing, so there is
//! nothing for either to say beyond itself.
//!
//! # Errors
//!
//! [`SpawnError`] is the whole of this module. A refusal it does not have a variant
//! for is a bug in whatever produced it, and there is no catch-all standing in for
//! one — a run that failed, was stopped or was killed is not an error at all, it is
//! an answer a report is written from.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::io;
use std::path::PathBuf;

use super::ReadError;
use crate::measure::MeasureError;

/// Why a run was never launched, or was launched and could not be read back.
///
/// Every variant names the path or the program to look at, so a refusal names the
/// run rather than reporting that something did not work.
#[derive(Debug, thiserror::Error)]
pub enum SpawnError {
    /// A command was handed with nothing in it to run.
    #[error("the command to run is empty")]
    EmptyCommand,
    /// The command's own name is the empty string, which names no program.
    #[error("the command to run has no program in it")]
    NamelessCommand,
    /// The isolation program, or a command run in its place, would not start.
    #[error("cannot start {}: {source}", program.display())]
    Unlaunchable {
        /// The program that would not start.
        program: PathBuf,
        /// What starting it was refused with.
        source: io::Error,
    },
    /// A run finished and left no log behind, so nothing measured it.
    #[error("the run wrote no log at {}", path.display())]
    NoMetaFile {
        /// Where the log was to have been written.
        path: PathBuf,
    },
    /// The launch returned a code nothing here reads: either the isolation program
    /// failed in a way it does not document, or a command run beside it did not do
    /// what it was asked to. The box is not set up either way.
    #[error("{program} returned an exit status ({code}) unknown")]
    Exit {
        /// The program that returned the code.
        program: String,
        /// The code it returned.
        code: i32,
    },
    /// A launch had to touch the run's own directory and could not.
    #[error("{source} at {}", path.display())]
    Io {
        /// The path the launch was working on.
        path: PathBuf,
        /// What the file system refused it with.
        source: io::Error,
    },
    /// A pipe carrying what a run printed could not be read to its end.
    #[error(transparent)]
    Pipe(ReadError),
    /// A log held a value that is not the number its key promises.
    #[error(transparent)]
    Measure(MeasureError),
}
