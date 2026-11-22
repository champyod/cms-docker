//! The logger service: its two methods, and the log file they write beside them.
//!
//! The log directory and the formatter settings are constructor arguments, not config reads, so the composition root decides them and a test owns its directory.

use std::fs::{self, File, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use cms_proto::Method;

use super::formatter::FormatterSettings;
use super::handlers;
use super::sink::Sink;
use crate::service;

/// The directory the service keeps its log files in, under the one it is given.
const LOG_DIRECTORY: &str = "cms";

/// The link the newest log file is always reachable under.
const LAST_LOG: &str = "last.log";

/// The name `Log` is served under, as `LogService.py:75` spells it.
const LOG_METHOD: &str = "Log";

/// The name `last_messages` is served under, as `LogService.py:120` spells it.
const LAST_MESSAGES_METHOD: &str = "last_messages";

/// A running logger: the file it opened, and the methods a [`Host`](crate::Host) serves for it.
#[derive(Debug)]
pub struct LogService {
    log_path: PathBuf,
}

impl LogService {
    /// Creates `<log_dir>/cms/<epoch>.log`, points `last.log` at it, and installs the sink.
    ///
    /// # Errors
    ///
    /// [`LogError`] when the directories, the file or the link cannot be made.
    pub fn new(log_dir: &Path, settings: FormatterSettings) -> Result<Self, LogError> {
        let directory = log_dir.join(LOG_DIRECTORY);
        fs::create_dir_all(&directory).map_err(LogError::Directory)?;
        let name = format!("{}.log", epoch_seconds()?);
        let log_path = directory.join(&name);
        let file = open_new(&log_path)?;
        point_last_log_at(&directory, &name)?;
        handlers::install(Sink::new(file, settings)).map_err(LogError::Sink)?;
        Ok(Self { log_path })
    }

    /// The methods this service answers, ready for [`Host::bind`](crate::Host::bind).
    ///
    /// The base methods come first, composed rather than declared: a service that
    /// forgot `echo` or `quit` would not be manageable by the tooling every other
    /// service is managed by.
    #[must_use]
    pub fn methods(&self) -> Vec<Method> {
        let mut methods = service::methods();
        methods.push(Method {
            name: LOG_METHOD,
            is_callable: true,
            handler: handlers::log_method,
        });
        methods.push(Method {
            name: LAST_MESSAGES_METHOD,
            is_callable: true,
            handler: handlers::last_messages_method,
        });
        methods
    }

    /// The file the service is writing to, which is what `last.log` points at.
    #[must_use]
    pub fn log_path(&self) -> &Path {
        &self.log_path
    }
}

/// Why a logger could not be started.
#[derive(Debug)]
pub enum LogError {
    /// The log directory could not be created.
    Directory(io::Error),
    /// The new log file could not be opened for writing.
    Open(io::Error),
    /// `last.log` could not be pointed at the new file.
    LastLog(io::Error),
    /// The clock is before the epoch, so the file has no seconds to be named after.
    Clock(std::time::SystemTimeError),
    /// The process's sink is unusable after a record failed mid-write.
    Sink(String),
}

impl std::fmt::Display for LogError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Directory(error) => write!(formatter, "cannot create the log directory: {error}"),
            Self::Open(error) => write!(formatter, "cannot open the log file: {error}"),
            Self::LastLog(error) => {
                write!(formatter, "cannot point last.log at the log file: {error}")
            }
            Self::Clock(error) => {
                write!(formatter, "the system clock is before the epoch: {error}")
            }
            Self::Sink(reason) => write!(formatter, "{reason}"),
        }
    }
}

impl std::error::Error for LogError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Directory(error) | Self::Open(error) | Self::LastLog(error) => Some(error),
            Self::Clock(error) => Some(error),
            Self::Sink(_) => None,
        }
    }
}

/// The seconds the log file is named after, truncated as `int(time.time())` truncates them.
fn epoch_seconds() -> Result<u64, LogError> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .map_err(LogError::Clock)
}

/// Opens the file the way `open(..., mode='w', encoding='utf-8')` opens it.
fn open_new(path: &Path) -> Result<File, LogError> {
    OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(path)
        .map_err(LogError::Open)
}

/// Removes the old link and makes a new one under the same name, relative to its own directory.
fn point_last_log_at(directory: &Path, name: &str) -> Result<(), LogError> {
    let link = directory.join(LAST_LOG);
    match fs::remove_file(&link) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(LogError::LastLog(error)),
    }
    std::os::unix::fs::symlink(name, link).map_err(LogError::LastLog)
}
