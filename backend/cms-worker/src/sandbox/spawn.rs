//! Starting a run, keeping both its pipes empty while it lasts, and reading it back.
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
//! A command that is one of the four run beside the isolation program takes the
//! other path entirely: it is started in the run's own directory, which is made
//! writable for the moment it takes and given back the permissions it had, its
//! output is discarded so that nothing it says reaches a contestant, and an empty
//! log is left behind so the launch is answered from a log like any other. Its
//! code is the whole of the answer there, and a code that is not zero is a box that
//! was never set up.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::fmt;
use std::fs;
use std::io::{self, Read};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Output, Stdio};
use std::thread::JoinHandle;

use super::{ExecutionLog, ExecutionStats, Outcome, Sandbox, SpawnError};

/// How much of a pipe is taken at a time, which is the size of a pipe's buffer.
const PIPE_CHUNK: usize = 8 * 1024;
/// The permissions a run's own directory is given while a run is inside it.
const MODE_RUNNING: u32 = 0o770;
/// The permissions it is given while a command is setting the box up beside it.
///
/// It is kept to its owner alone, because such a command runs with no isolation
/// around it and nothing it touches should be reachable by the run that follows.
const MODE_BYPASSED: u32 = 0o700;
/// A mode's own permissions, without the file type it was read with.
const MODE_PERMISSIONS: u32 = 0o7777;
/// The log a command run beside the isolation program leaves behind: a run that
/// measured nothing, written as though it had measured zero of everything.
const EMPTY_LOG: &str = "time:0.000\ntime-wall:0.000\nmax-rss:0\ncg-mem:0\n";

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

impl Sandbox {
    /// Starts the run, waits for it, and answers for the launch itself.
    ///
    /// A code that has no reading here is refused before the run's log is looked
    /// at, because a log written by a program that could not run the run is not a
    /// measurement. Everything else the launch produced is handed back for the log
    /// to be read into.
    /// # Errors
    /// [`SpawnError`] for a program that would not start, a directory that could
    /// not be prepared, a log that could not be written, a pipe that could not be
    /// read, or a code nothing here reads.
    pub(super) fn launch(
        &self,
        program: &[String],
        number: u32,
        bypassed: bool,
    ) -> Result<Output, SpawnError> {
        let Some(name) = program.first() else {
            return Err(SpawnError::EmptyCommand);
        };
        let launched =
            self.with_writable_home(bypassed, || start(program, &self.layout.home, bypassed))?;
        if bypassed {
            self.write_empty_log(number)?;
        }
        Self::accept(launched.status, bypassed, name)?;
        Ok(launched)
    }

    /// What a code the launch returned means, and which program returned it.
    /// # Errors
    /// [`SpawnError::Exit`] for a code outside the closed set, and for a process
    /// that was stopped before it returned one.
    fn accept(status: ExitStatus, bypassed: bool, name: &str) -> Result<(), SpawnError> {
        let read = if bypassed {
            Outcome::of_bypassed(status)
        } else {
            Outcome::of_sandbox(status)
        };
        read.map(|_| ()).map_err(|unknown| SpawnError::Exit {
            program: name.to_owned(),
            code: unknown.code,
        })
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
    pub(super) fn read_log(&self, number: u32) -> Result<ExecutionLog, SpawnError> {
        let path = self.layout.meta_file(number);
        let text = fs::read_to_string(&path).map_err(|_| SpawnError::NoMetaFile { path })?;
        ExecutionLog::parse(&text).map_err(SpawnError::Measure)
    }

    /// Leaves the log a command run beside the isolation program is answered from:
    /// a run that measured nothing, written as though it measured zero.
    /// # Errors
    /// [`SpawnError::Io`] when the log could not be written.
    fn write_empty_log(&self, number: u32) -> Result<(), SpawnError> {
        let path = self.layout.meta_file(number);
        fs::write(&path, EMPTY_LOG).map_err(|source| SpawnError::Io { path, source })
    }

    /// The run's own directory made writable for a launch and given back the
    /// permissions it had, so a run that created files cannot lock the next one
    /// out of the directory they share.
    fn with_writable_home<T>(
        &self,
        bypassed: bool,
        launch: impl FnOnce() -> Result<T, SpawnError>,
    ) -> Result<T, SpawnError> {
        let previous = self.home_mode()?;
        self.set_home_mode(home_mode(bypassed))?;
        let launched = launch();
        self.set_home_mode(previous)?;
        launched
    }

    fn home_mode(&self) -> Result<u32, SpawnError> {
        let home = self.home();
        fs::metadata(home)
            .map(|metadata| metadata.permissions().mode() & MODE_PERMISSIONS)
            .map_err(|source| SpawnError::Io {
                path: home.to_path_buf(),
                source,
            })
    }

    fn set_home_mode(&self, mode: u32) -> Result<(), SpawnError> {
        let home = self.home();
        fs::set_permissions(home, fs::Permissions::from_mode(mode)).map_err(|source| {
            SpawnError::Io {
                path: home.to_path_buf(),
                source,
            }
        })
    }
}

/// The permissions a run's own directory is given for a launch.
const fn home_mode(bypassed: bool) -> u32 {
    if bypassed {
        MODE_BYPASSED
    } else {
        MODE_RUNNING
    }
}

/// Starts a program with both its pipes emptied while it runs, and waits for it.
///
/// A command run beside the isolation program is started in the run's own
/// directory, since it is the one writing the files the run is handed, and it has
/// no pipes to fill: its output goes nowhere, because nothing it says is a
/// contestant's to read.
fn start(program: &[String], home: &Path, bypassed: bool) -> Result<Output, SpawnError> {
    let mut command = Command::new(&program[0]);
    command.args(&program[1..]).stdin(Stdio::null());
    if bypassed {
        return run_quiet(&mut command, &program[0], home);
    }
    run_drained(&mut command, &program[0])
}

fn run_drained(command: &mut Command, name: &str) -> Result<Output, SpawnError> {
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|source| unlaunchable(name, source))?;
    let drained = drain(&mut child);
    let status = child.wait().map_err(|source| unlaunchable(name, source))?;
    let drained = drained.map_err(SpawnError::Pipe)?;
    Ok(Output {
        status,
        stdout: drained.stdout,
        stderr: drained.stderr,
    })
}

fn run_quiet(command: &mut Command, name: &str, home: &Path) -> Result<Output, SpawnError> {
    let output = command
        .current_dir(home)
        .output()
        .map_err(|source| unlaunchable(name, source))?;
    Ok(Output {
        status: output.status,
        stdout: Vec::new(),
        stderr: Vec::new(),
    })
}

fn unlaunchable(name: &str, source: io::Error) -> SpawnError {
    SpawnError::Unlaunchable {
        program: PathBuf::from(name),
        source,
    }
}

/// Empties both of a running child's pipes, each by a thread of its own.
///
/// Both readers are started before either is waited for, which is the whole of
/// the drain: a run blocked on a pipe nobody is reading cannot finish, and
/// waiting for one reader before the other exists would leave the second pipe
/// unread for exactly as long as the first was full.
fn drain(child: &mut Child) -> Result<Drained, ReadError> {
    let out = child.stdout.take().map(|pipe| reader(pipe, Stream::Output));
    let err = child.stderr.take().map(|pipe| reader(pipe, Stream::Error));
    Ok(Drained {
        stdout: take_pipe(out)?,
        stderr: take_pipe(err)?,
    })
}

/// Both pipes of a run, read to their end.
struct Drained {
    stdout: Vec<u8>,
    stderr: Vec<u8>,
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
