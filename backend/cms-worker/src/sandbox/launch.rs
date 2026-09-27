//! A run that has been started and has not been waited for.
//!
//! [`Sandbox::start`] answers with one of these rather than with what the run left
//! behind, so that a caller which needs two runs alive at the same time starts both
//! before it waits for either. That is the only order in which two runs that have to
//! talk to each other can both make progress: the first one waited for is still
//! running, and the second has not been started.
//!
//! Both pipes are emptied from the launch, so a run that prints more than a pipe
//! holds is read for the whole of its life and not only from the moment somebody
//! waits for it. Waiting gives the run's own directory back the permissions it had,
//! which a caller starting several runs would otherwise have to do itself and could
//! do to the wrong one.
//!
//! # Errors
//!
//! [`SpawnError`], and only that: a command with nothing in it, a program that
//! cannot be started, a directory that could not be prepared, a pipe that could not
//! be read to its end, a log no run wrote, a number a log holds and cannot read, and
//! a code the isolation program does not document.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::path::PathBuf;
use std::process::{Child, Command, Output, Stdio};

use super::spawn::{set_mode, MODE_RUNNING};
use super::stream::Readers;
use super::{read_log, Sandbox, SpawnError};
use crate::stats::ExecutionStats;

/// A run that has been started and has not been waited for: the process itself, the
/// two readers emptying its pipes, where it is to write its log, and the permissions
/// its own directory is to be given back to.
///
/// A caller that starts several runs at once holds one of these for each and waits
/// for them all.
pub struct Launch {
    child: Child,
    readers: Readers,
    meta: PathBuf,
    program: String,
    home: PathBuf,
    home_mode: u32,
}

impl Launch {
    /// Waits for the run to end, empties both of its pipes to their end, and
    /// answers with what the run left behind: its figures, why it ended and what it
    /// printed. The run's own directory is given back the permissions it had.
    ///
    /// # Errors
    ///
    /// [`SpawnError`], and only that: the process could not be waited for, the
    /// directory could not be given back its permissions, a pipe could not be read
    /// to its end, the run wrote no log, a number in that log could not be read, and
    /// a code the isolation program does not document.
    pub fn wait(self) -> Result<ExecutionStats, SpawnError> {
        let Launch {
            mut child,
            readers,
            meta,
            program,
            home,
            home_mode,
        } = self;
        let status = child
            .wait()
            .map_err(|source| unlaunchable(&program, source))?;
        set_mode(&home, home_mode)?;
        let drained = readers.finish().map_err(SpawnError::Pipe)?;
        Sandbox::accept(status, false, &program)?;
        let log = read_log(&meta)?;
        Sandbox::finish(
            &Output {
                status,
                stdout: drained.stdout,
                stderr: drained.stderr,
            },
            &log,
        )
    }
}

impl Sandbox {
    /// Starts one run and answers with the run itself, still running, rather than
    /// with what it left behind.
    ///
    /// The run's own directory is made writable for the launch and given back the
    /// permissions it had by [`Launch::wait`], so that a run can write in it for as
    /// long as it lasts. A command run beside the isolation program leaves no log of
    /// its own and is refused by the log it never writes.
    ///
    /// # Errors
    ///
    /// [`SpawnError`], and only that: the command or the program could not be
    /// started, and the run's own directory could not be prepared.
    pub fn start(&mut self, command: &[&str]) -> Result<Launch, SpawnError> {
        let program = self.program_for(command)?;
        let number = self.next_execution();
        let previous = self.home_mode()?;
        self.set_home_mode(MODE_RUNNING)?;
        match start_running(&program) {
            Ok((child, readers)) => Ok(Launch {
                child,
                readers,
                meta: self.layout.meta_file(number),
                program: program[0].clone(),
                home: self.home().to_path_buf(),
                home_mode: previous,
            }),
            Err(error) => {
                self.set_home_mode(previous)?;
                Err(error)
            }
        }
    }
}

/// Starts a run under the isolation program and hands back the process while it is
/// still running, with both of its pipes emptied by a thread of their own.
///
/// This is the other half of the launch that waits, and it is the half a caller
/// needs when the run has to be alive beside another one.
fn start_running(program: &[String]) -> Result<(Child, Readers), SpawnError> {
    let mut command = Command::new(&program[0]);
    command
        .args(&program[1..])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|source| unlaunchable(&program[0], source))?;
    let readers = Readers::of(&mut child);
    Ok((child, readers))
}

fn unlaunchable(name: &str, source: std::io::Error) -> SpawnError {
    SpawnError::Unlaunchable {
        program: PathBuf::from(name),
        source,
    }
}
