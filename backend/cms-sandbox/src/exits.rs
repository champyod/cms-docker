//! What the code a run returned is worth, and what a run beside the sandbox is.
//!
//! A run is answered twice over, and the two answers are not the same question.
//! The code the isolation program returned says whether the isolation program
//! worked at all; the log the run left says what happened inside it. A code is
//! never on its own a verdict: a run that returned non-zero, was stopped for its
//! time and was killed for its memory all leave the isolation program returning
//! the same thing, and only the log tells those apart. So the code is read
//! first, because a code nothing here recognises means the isolation program
//! itself failed and nothing it wrote can be believed — reading such a log would
//! report a measurement of nothing as though it were a measurement.
//!
//! Two codes mean the isolation program worked: the run inside it finished, and
//! the run inside it ended badly. Which of the two it was says nothing about
//! whether the run was stopped, killed or returned non-zero. Every other code is
//! refused rather than guessed at.
//!
//! The four commands run beside the isolation program have none to return a code,
//! so they are the one case where the code is the whole of the answer. It is
//! still the same question: zero is a command that did what it was asked to, and
//! anything else is a box that was never set up. That is a failure of the worker
//! rather than of a run, and a caller that launched one has to hear about it
//! rather than read a measurement that was never taken.
//!
//! # Errors
//!
//! [`UnknownExitCode`], and nothing else. The set of codes is closed, so a code
//! outside it is the isolation program having failed in a way nothing here has a
//! reading for. A process stopped by a signal is in that set too: it never
//! returned a code, so there is no number to report and none is invented.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::fmt;
use std::process::ExitStatus;

/// The code the isolation program returns when the run inside it finished.
const CODE_RUN_FINISHED: i32 = 0;
/// The code it returns when the run inside it ended badly — stopped, killed, or
/// returned a code that is not zero. A run that ended, and not as it was asked to.
const CODE_RUN_ENDED: i32 = 1;
/// What a process that never returned a code is reported under.
///
/// A signal is not a code, and a number taken from one could be mistaken for a
/// code the isolation program documented, so the two are told apart by a number
/// no process can return.
const SIGNALLED: i32 = -1;

/// The isolation program returned a code nothing here has a reading for.
///
/// The launch is not a measurement and cannot be turned into one, so it is
/// refused rather than reported as a run that failed for an unknown reason.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UnknownExitCode {
    /// The code the isolation program returned, or [`SIGNALLED`] for a process
    /// that was stopped by a signal.
    pub code: i32,
}

impl fmt::Display for UnknownExitCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "the sandbox returned an exit status ({}) unknown",
            self.code
        )
    }
}

impl std::error::Error for UnknownExitCode {}

/// What a finished launch's code says about the isolation program having run.
///
/// This is deliberately not a verdict on the run itself: both of the codes it
/// accepts mean the isolation program worked, and which of the two it was says
/// nothing about why the run ended. Read the run's log for that.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    /// The isolation program worked, and the run inside it finished.
    RunFinished,
    /// The isolation program worked, and the run inside it ended badly.
    RunEnded,
}

impl Outcome {
    /// What a code the isolation program returned means.
    ///
    /// # Errors
    /// [`UnknownExitCode`] for any code other than the two the isolation
    /// program documents, which is a failure of the isolation program itself
    /// rather than of anything the run inside it did.
    pub const fn of(code: i32) -> Result<Self, UnknownExitCode> {
        match code {
            CODE_RUN_FINISHED => Ok(Self::RunFinished),
            CODE_RUN_ENDED => Ok(Self::RunEnded),
            code => Err(UnknownExitCode { code }),
        }
    }

    /// What a launch that went through the isolation program means.
    ///
    /// # Errors
    /// [`UnknownExitCode`] for a process stopped by a signal, and for a code
    /// outside the closed set.
    pub fn of_sandbox(status: ExitStatus) -> Result<Self, UnknownExitCode> {
        Self::of(code_of(status)?)
    }

    /// What a launch of a command run beside the isolation program means.
    ///
    /// Zero is a command that set the box up, and anything else is a box that
    /// was not set up: there is no log to read and no measurement to take, so a
    /// code of its own is refused instead of being answered as a failed run.
    ///
    /// # Errors
    /// [`UnknownExitCode`] for a process stopped by a signal, and for a code
    /// that is not zero.
    pub fn of_bypassed(status: ExitStatus) -> Result<Self, UnknownExitCode> {
        match code_of(status)? {
            CODE_RUN_FINISHED => Ok(Self::RunFinished),
            code => Err(UnknownExitCode { code }),
        }
    }
}

/// The code a process returned, or the standing for one it never returned.
fn code_of(status: ExitStatus) -> Result<i32, UnknownExitCode> {
    status.code().ok_or(UnknownExitCode { code: SIGNALLED })
}
