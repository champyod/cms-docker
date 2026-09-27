//! A run's two pipes, emptied while it is alive, and why a read can fail.
//!
//! A run that prints more than a pipe holds would block on the write and never
//! finish, so both pipes are emptied for as long as the run is alive rather than
//! after it ends. Each pipe is read by a thread of its own to its very end, and
//! the launch waits for both threads before it answers, so what the run printed is
//! here rather than stuck in a pipe. Reading the two pipes in turn instead would
//! deadlock on whichever of them filled first, and reading neither would deadlock
//! on the first of them: the run cannot finish while this side is not reading, so
//! this side reads while the run is running.
//!
//! Nothing here waits on a clock of its own. The limits a run is held to are the
//! ones it was launched with, which the isolation program enforces and which its
//! log reports; a wall-clock stop is told apart from a CPU one by the message the
//! log wrote. A launch is over when the run is over, and a run the isolation
//! program could not stop is the isolation program's to answer for.
//!
//! A failure is named by which pipe it was, because the two are not the same
//! trouble: what a run wrote to its error is the isolation program's own complaint
//! about the run, while what it wrote to its output is the run's answer. A caller
//! shown one without the other cannot tell which it has.
//!
//! # Errors
//!
//! [`ReadError`], and nothing else: a pipe that could not be read to its end, and
//! the two ways a finished launch can have nothing to be decided from — a process
//! stopped before it returned a code, and a code the isolation program does not
//! document. A run that failed is not an error: it is a run.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::fmt;
use std::io::{self, Read};
use std::process::Child;
use std::thread::JoinHandle;

/// How much of a pipe is taken at a time, which is the size of a pipe's buffer.
const PIPE_CHUNK: usize = 8 * 1024;

/// Which of a run's two pipes is meant, for saying which one could not be read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stream {
    /// What the run wrote to its standard output.
    Output,
    /// What the run wrote to its standard error.
    Error,
}

impl fmt::Display for Stream {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Output => write!(f, "standard output"),
            Self::Error => write!(f, "standard error"),
        }
    }
}

/// Why what a run printed could not be read.
#[derive(Debug)]
pub enum ReadError {
    /// A pipe the run was writing to could not be read to its end.
    Pipe {
        /// Whether it was the run's output or its error that failed.
        stream: Stream,
        /// What reading it was refused with.
        source: io::Error,
    },
    /// The run finished without returning a code, so nothing was decided.
    NoExitCode,
    /// The isolation program returned a code nothing here has a reading for.
    UnknownCode(i32),
}

impl fmt::Display for ReadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Pipe { stream, source } => {
                write!(f, "cannot read the run's {stream}: {source}")
            }
            Self::NoExitCode => write!(f, "the run was stopped before it returned a code"),
            Self::UnknownCode(code) => {
                write!(f, "the sandbox returned an exit status ({code}) unknown")
            }
        }
    }
}

impl std::error::Error for ReadError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Pipe { source, .. } => Some(source),
            Self::NoExitCode | Self::UnknownCode(_) => None,
        }
    }
}

/// Empties both of a running child's pipes, each by a thread of its own.
///
/// Both readers are started before either is waited for, which is the whole of the
/// drain: a run blocked on a pipe nobody is reading cannot finish, and waiting for
/// one reader before the other exists would leave the second pipe unread for
/// exactly as long as the first was full.
pub(super) fn drain(child: &mut Child) -> Result<Drained, ReadError> {
    let out = child.stdout.take().map(|pipe| reader(pipe, Stream::Output));
    let err = child.stderr.take().map(|pipe| reader(pipe, Stream::Error));
    Ok(Drained {
        stdout: take_pipe(out)?,
        stderr: take_pipe(err)?,
    })
}

/// Both pipes of a run, read to their end.
pub(super) struct Drained {
    /// Everything the run wrote to its standard output.
    pub(super) stdout: Vec<u8>,
    /// Everything the run wrote to its standard error.
    pub(super) stderr: Vec<u8>,
}

/// A thread reading one pipe to its end, which is the whole of the drain.
type Reader = JoinHandle<Result<Vec<u8>, ReadError>>;

/// Empties one pipe from a thread of its own, for as long as the run lasts.
fn reader(mut pipe: impl Read + Send + 'static, stream: Stream) -> Reader {
    std::thread::spawn(move || {
        let mut read = Vec::new();
        let mut chunk = [0_u8; PIPE_CHUNK];
        loop {
            let filled = pipe
                .read(&mut chunk)
                .map_err(|source| ReadError::Pipe { stream, source })?;
            if filled == 0 {
                return Ok(read);
            }
            read.extend_from_slice(&chunk[..filled]);
        }
    })
}

/// Waits for a reader and hands back everything it read.
fn take_pipe(pipe: Option<Reader>) -> Result<Vec<u8>, ReadError> {
    let Some(pipe) = pipe else {
        return Ok(Vec::new());
    };
    pipe.join().unwrap_or_else(|_| Err(pipe_lost()))
}

/// A reader whose thread is gone: the output is lost rather than half read.
fn pipe_lost() -> ReadError {
    ReadError::Pipe {
        stream: Stream::Output,
        source: io::Error::other("the thread reading the run's output is gone"),
    }
}
