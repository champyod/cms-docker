//! The log one sandboxed run wrote, and the one status its codes mean.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::collections::BTreeMap;
use std::fmt;
use std::str::FromStr;

const KEY_CPU_TIME: &str = "time";
const KEY_WALL_TIME: &str = "time-wall";
/// Log key holding peak memory, in kibibytes: the unit isolate measures in.
const KEY_MEMORY: &str = "cg-mem";
const KEY_STATUS: &str = "status";
const KEY_EXIT_SIGNAL: &str = "exitsig";
const KEY_EXIT_CODE: &str = "exitcode";
/// Log key holding why a run was stopped, when the code alone cannot say.
const KEY_MESSAGE: &str = "message";
/// Log key the isolate writes when it killed a run for want of memory.
const KEY_OOM_KILLED: &str = "cg-oom-killed";
const WALL_CLOCK_WORD: &str = "wall";
/// The codes a run is reported by, before the log's further keys are read.
const CODE_SANDBOX_ERROR: &str = "XX";
const CODE_TIMEOUT: &str = "TO";
const CODE_SIGNAL: &str = "SG";
const CODE_NONZERO_RETURN: &str = "RE";
const BYTES_PER_KIBIBYTE: u64 = 1024;

/// Why a log could not be read as a measurement.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MeasureError {
    /// A line carried no `:` to split a key from a value, counted from one.
    UnnamedLine(usize),
    /// A value is not the number its key promises to hold.
    Unreadable {
        /// The key whose value could not be read.
        key: &'static str,
        /// The value as the log wrote it.
        value: String,
    },
}

impl fmt::Display for MeasureError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnnamedLine(line) => write!(f, "log line {line} names no key"),
            Self::Unreadable { key, value } => {
                write!(f, "log key `{key}` holds no number: {value}")
            }
        }
    }
}

impl std::error::Error for MeasureError {}

/// One run's log: the `key: value` lines isolate wrote, read into a map.
///
/// A key written twice keeps both values, and every reading here asks for the first.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ExecutionLog {
    entries: BTreeMap<String, Vec<String>>,
}

impl ExecutionLog {
    /// Reads a log of trimmed lines, each split at its first `:`.
    /// # Errors
    /// [`MeasureError::UnnamedLine`] for a line with no `:` at all.
    pub fn parse(text: &str) -> Result<Self, MeasureError> {
        let mut entries: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for (index, line) in text.lines().enumerate() {
            let Some((key, value)) = line.trim().split_once(':') else {
                return Err(MeasureError::UnnamedLine(index + 1));
            };
            entries
                .entry(key.to_owned())
                .or_default()
                .push(value.trim().to_owned());
        }
        Ok(Self { entries })
    }

    /// The CPU time a run was charged, in seconds; `None` when it measured none.
    /// # Errors
    /// [`MeasureError::Unreadable`] when the value is not a number.
    pub fn cpu_time(&self) -> Result<Option<f64>, MeasureError> {
        self.read(KEY_CPU_TIME, None)
    }

    /// The clock a run took from start to stop, in seconds; `None` when none.
    /// # Errors
    /// [`MeasureError::Unreadable`] when the value is not a number.
    pub fn wall_time(&self) -> Result<Option<f64>, MeasureError> {
        self.read(KEY_WALL_TIME, None)
    }

    /// Peak memory of the run in bytes, saturating rather than wrapping.
    /// # Errors
    /// [`MeasureError::Unreadable`] when the value is not a number.
    pub fn memory_bytes(&self) -> Result<Option<u64>, MeasureError> {
        let kibibytes = self.read::<u64>(KEY_MEMORY, None)?;
        Ok(kibibytes.map(|peak| peak.saturating_mul(BYTES_PER_KIBIBYTE)))
    }

    /// The code a run returned, or zero when the log never wrote one.
    /// # Errors
    /// [`MeasureError::Unreadable`] when the value is not a number.
    pub fn exit_code(&self) -> Result<i64, MeasureError> {
        Ok(self.read(KEY_EXIT_CODE, Some(0))?.unwrap_or(0))
    }

    /// The signal that killed a run, or zero when the log never wrote one.
    /// # Errors
    /// [`MeasureError::Unreadable`] when the value is not a number.
    pub fn killing_signal(&self) -> Result<i64, MeasureError> {
        Ok(self.read(KEY_EXIT_SIGNAL, Some(0))?.unwrap_or(0))
    }

    fn first(&self, key: &str) -> Option<&str> {
        self.entries.get(key)?.first().map(String::as_str)
    }

    /// Whether the log ended a run with a code.
    fn ended_with(&self, code: &str) -> bool {
        self.entries
            .get(KEY_STATUS)
            .is_some_and(|codes| codes.iter().any(|logged| logged == code))
    }

    /// The first value of a key read as a number, or `absent` when unwritten.
    fn read<T: FromStr>(
        &self,
        key: &'static str,
        absent: Option<T>,
    ) -> Result<Option<T>, MeasureError> {
        let Some(value) = self.first(key) else {
            return Ok(absent);
        };
        let number = value.parse().map_err(|_| MeasureError::Unreadable {
            key,
            value: value.to_owned(),
        })?;
        Ok(Some(number))
    }
}

/// The seven ways a run can end, and the only ones there are.
///
/// The set is closed, so a status added to it is one every match must answer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExitStatus {
    /// The run finished and returned, whatever code it returned.
    Ok,
    /// The isolate itself failed, so nothing the run reported can be trusted.
    SandboxError,
    /// The run was stopped for using more CPU time than it was allowed.
    Timeout,
    /// The run was stopped for taking more wall clock than it was allowed.
    TimeoutWall,
    /// The run was killed by a signal.
    Signal,
    /// The run was killed for asking for more memory than the machine had.
    MemoryLimit,
    /// The run returned a code that is not zero.
    NonzeroReturn,
}

impl ExitStatus {
    /// Why one run ended: the arms are the precedence, in the order the codes
    /// are asked for, so a run reporting several is reported by the first.
    /// # Errors
    /// None. Every arm is decided from keys the log wrote or did not.
    #[must_use]
    pub fn of(log: &ExecutionLog) -> Self {
        match (
            log.ended_with(CODE_SANDBOX_ERROR),
            log.ended_with(CODE_TIMEOUT),
            log.ended_with(CODE_SIGNAL),
            log.ended_with(CODE_NONZERO_RETURN),
        ) {
            (true, _, _, _) => Self::SandboxError,
            // One code covers both limits; the message alone says which ran out.
            (false, true, _, _) => Self::stopped(log),
            // The memory limit only when the isolate recorded an OOM kill: no limit was hit.
            (false, false, true, _) => Self::killed(log),
            (false, false, false, true) => Self::NonzeroReturn,
            // `OK` is implicit: isolate never writes it.
            (false, false, false, false) => Self::Ok,
        }
    }

    /// The sentence a report shows for a run that ended this way.
    ///
    /// A memory-limit kill is stated here rather than left unanswered: the
    /// reference has no arm for that status, and a case it fails to match is a
    /// report with nothing in it.
    /// # Errors
    /// [`MeasureError::Unreadable`] for the number quoted, and only for it.
    pub fn human_description(self, log: &ExecutionLog) -> Result<String, MeasureError> {
        Ok(match self {
            Self::Ok => {
                format!(
                    "Execution successfully finished (with exit code {})",
                    log.exit_code()?
                )
            }
            Self::SandboxError => "Execution failed because of sandbox error".to_owned(),
            Self::Timeout => "Execution timed out".to_owned(),
            Self::TimeoutWall => "Execution timed out (wall clock limit exceeded)".to_owned(),
            Self::Signal => format!("Execution killed with signal {}", log.killing_signal()?),
            Self::MemoryLimit => "Execution killed because it exceeded the memory limit".into(),
            Self::NonzeroReturn => "Execution failed because the return code was nonzero".into(),
        })
    }

    /// Which clock a stop ran out of, told apart by what its message says.
    fn stopped(log: &ExecutionLog) -> Self {
        let message = log.first(KEY_MESSAGE).unwrap_or_default();
        if message.contains(WALL_CLOCK_WORD) {
            return Self::TimeoutWall;
        }
        Self::Timeout
    }

    /// Why a run was killed: the isolate ran out of memory, or a signal ended it.
    fn killed(log: &ExecutionLog) -> Self {
        match log.first(KEY_OOM_KILLED) {
            Some(_) => Self::MemoryLimit,
            None => Self::Signal,
        }
    }
}
