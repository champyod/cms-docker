//! Starting a child process: the seam that keeps `std::process::Command` out of every test.

use std::fmt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

use super::coord::ServiceCoord;
use super::naming::binary_name;

/// The argv one service is started with, spelled the way the matcher reads it back.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServiceCommand {
    program: PathBuf,
    args: Vec<String>,
}

impl ServiceCommand {
    /// `_restart_services`'s `args`, built in the binary spelling the matcher inverts.
    ///
    /// # Errors
    ///
    /// [`SpawnError::Unnameable`] when the service's name has no binary spelling, since a process
    /// started under a name the matcher cannot read would be started again on every pass.
    pub fn of(
        coord: &ServiceCoord,
        bin_path: &Path,
        contest_id: Option<i64>,
    ) -> Result<Self, SpawnError> {
        let program = binary_name(coord.name())
            .map(|name| bin_path.join(name))
            .ok_or_else(|| SpawnError::Unnameable(coord.clone()))?;
        // WHY: Python gives a contest id even to services that do not need one, since it does no harm.
        let contest = contest_id.map_or_else(|| "ALL".to_owned(), |id| id.to_string());
        Ok(Self {
            program,
            args: vec![coord.shard().to_string(), "-c".to_owned(), contest],
        })
    }

    /// The binary to run.
    #[must_use]
    pub fn program(&self) -> &Path {
        &self.program
    }

    /// The arguments after it.
    #[must_use]
    pub fn args(&self) -> &[String] {
        &self.args
    }
}

impl fmt::Display for ServiceCommand {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}", self.program.display())?;
        for arg in &self.args {
            write!(formatter, " {arg}")?;
        }
        Ok(())
    }
}

/// Why a child was not started.
#[derive(Debug)]
pub enum SpawnError {
    /// The service's name has no binary spelling the command-line matcher could read back.
    Unnameable(ServiceCoord),
    /// The OS refused to start the process.
    Failed {
        /// The command line that was attempted, as the log reports it.
        command: ServiceCommand,
        /// What the OS said.
        source: std::io::Error,
    },
}

impl fmt::Display for SpawnError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unnameable(coord) => {
                write!(formatter, "{coord} has no binary name the matcher can read")
            }
            Self::Failed { command, source } => {
                write!(formatter, "cannot start {command}: {source}")
            }
        }
    }
}

impl std::error::Error for SpawnError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Unnameable(_) => None,
            Self::Failed { source, .. } => Some(source),
        }
    }
}

/// A child this service started, as the next pass asks whether it is still running.
pub trait SpawnedChild {
    /// Whether it is still running, Python's `poll()` answering `None`.
    fn is_alive(&mut self) -> bool;
}

/// The only way a child process is started, so a test records a spawn instead of making one.
pub trait Spawner {
    /// Starts `command`, or says why it could not.
    ///
    /// # Errors
    ///
    /// [`SpawnError`] when the name has no binary spelling or the OS refused the process.
    fn spawn(&mut self, command: &ServiceCommand) -> Result<Box<dyn SpawnedChild>, SpawnError>;
}

/// The production spawner: the only place in the crate that touches [`Command`].
#[derive(Debug, Default, Clone, Copy)]
pub struct ProcessSpawner;

impl ProcessSpawner {
    /// A spawner that starts real processes.
    #[must_use]
    pub fn new() -> Self {
        Self
    }
}

impl Spawner for ProcessSpawner {
    fn spawn(&mut self, command: &ServiceCommand) -> Result<Box<dyn SpawnedChild>, SpawnError> {
        // WHY: Python sends both streams to /dev/null, so a restarted service cannot hold a pipe.
        let child = Command::new(command.program())
            .args(command.args())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|source| SpawnError::Failed {
                command: command.clone(),
                source,
            })?;
        Ok(Box::new(ProcessChild { child }))
    }
}

/// A real child, polled the way `Popen.poll` reaps a zombie.
struct ProcessChild {
    child: Child,
}

impl SpawnedChild for ProcessChild {
    fn is_alive(&mut self) -> bool {
        // WHY: only a reaped exit proves death, and a failed poll read as death starts a duplicate every pass.
        !matches!(self.child.try_wait(), Ok(Some(_)))
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::{ServiceCommand, SpawnError};
    use crate::resource_service::interesting_command_line;
    use crate::resource_service::ServiceCoord;

    const BIN: &str = "/opt/cms/bin";

    fn command(name: &str, shard: i32, contest_id: Option<i64>) -> ServiceCommand {
        ServiceCommand::of(&ServiceCoord::new(name, shard), Path::new(BIN), contest_id)
            .expect("a CMS service name has a binary name")
    }

    #[test]
    fn a_command_names_the_binary_in_the_matcher_spelling() {
        let built = command("ScoringService", 0, Some(7));
        assert_eq!(
            built.program(),
            Path::new("/opt/cms/bin/cms-scoring-service")
        );
        assert_eq!(built.args(), ["0", "-c", "7"]);
    }

    #[test]
    fn a_service_without_a_contest_is_asked_for_all_of_them() {
        assert_eq!(command("Checker", 2, None).args(), ["2", "-c", "ALL"]);
    }

    #[test]
    fn a_spawned_command_line_is_recognised_by_the_matcher() {
        for (name, shard) in [("Worker", 0), ("ProxyService", 3), ("ContestWebServer", 1)] {
            let built = command(name, shard, Some(7));
            let mut words = vec![built.program().to_string_lossy().into_owned()];
            words.extend(built.args().iter().cloned());
            assert_eq!(
                interesting_command_line(&words, Path::new(BIN)),
                Some((name.to_owned(), Some(shard))),
                "autorestart would spawn {} and then not see it",
                built
            );
        }
    }

    #[test]
    fn a_name_with_no_binary_spelling_is_refused() {
        let coord = ServiceCoord::new("Worker2", 0);
        let error = ServiceCommand::of(&coord, Path::new(BIN), None).expect_err("no spelling");
        assert!(matches!(error, SpawnError::Unnameable(ref name) if name == &coord));
    }
}
