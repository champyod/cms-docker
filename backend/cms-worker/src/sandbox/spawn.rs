//! Starting a run, keeping both its pipes empty while it lasts, and reading it back.
//!
//! This is the module that touches the machine: it makes the run's own directory
//! writable for the length of a launch, starts the program, and reads back the log
//! the run left. The pipes themselves are [`super::stream`]'s subject, and the
//! limits a run is held to are [`super::Options`]'s.
//!
//! Nothing here waits on a clock of its own. The limits are the ones a run was
//! launched with, which the isolation program enforces and which its log reports;
//! a wall-clock stop is told apart from a CPU one by the message the log wrote. A
//! launch is over when the run is over, and a run the isolation program could not
//! stop is the isolation program's to answer for.
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

use std::fs;
use std::io;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Output, Stdio};

use super::stream::drain;
use super::{Outcome, Sandbox, SpawnError};

/// The commands run beside the isolation program rather than inside it.
///
/// They create files the run has to see, and they read nothing a contestant wrote,
/// which is what makes running them unsandboxed safe.
pub const SECURE_COMMANDS: [&str; 4] = ["/bin/cp", "/bin/mv", "/usr/bin/zip", "/usr/bin/unzip"];
/// The name a box's directory is given before its own unique suffix.
const OUTER_DIRECTORY_PREFIX: &str = "cms-sandbox-";
/// The prefix of the file one run's measurements are written to.
const META_PREFIX: &str = "run.log";
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

/// The outer directory, the run's own directory inside it, and the program.
///
/// Both paths are made once, when a sandbox is built, and every path a launch
/// works on is reached through here rather than named by a launch of its own.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Layout {
    /// The box's own directory, which a run's log is written into.
    pub outer: PathBuf,
    /// The directory a run writes in, which is the one it is bound to.
    pub home: PathBuf,
    /// The program the run is launched under.
    pub executable: PathBuf,
}

impl Layout {
    /// A layout under a caller-named directory, holding a run's own directory.
    pub(super) fn create(temp_dir: &Path, name: &str, executable: &Path) -> io::Result<Self> {
        let outer = temp_dir.join(format!("{OUTER_DIRECTORY_PREFIX}{name}"));
        let home = outer.join("home");
        fs::create_dir_all(&home)?;
        Ok(Self {
            outer,
            home,
            executable: executable.to_path_buf(),
        })
    }

    /// The file the run numbered `number` has its measurements written to.
    pub(super) fn meta_file(&self, number: u32) -> PathBuf {
        self.outer.join(format!("{META_PREFIX}.{number}"))
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
