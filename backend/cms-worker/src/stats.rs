//! The numbers, status and output of one run, and what several runs fold into.
//!
//! A measurement that was never taken is `None` rather than zero, so a run
//! stopped before it could be measured is not read as one that took no time.
//! Folding several runs together is the other half: a compilation adds up what
//! its compilers cost, and whether two of them ran at once decides whether the
//! wall clock is widened or added and the peak summed or kept.
//!
//! # Errors
//!
//! [`MeasureError`](crate::MeasureError), and only that: a value the log holds
//! and cannot read as the number its key promises.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::ops::Add;

use crate::measure::{ExecutionLog, ExitStatus, MeasureError};

/// What separates two outputs once several runs are merged into one.
const OUTPUT_SEPARATOR: &str = "\n===\n";

/// What one run left behind: the numbers, why it ended, and what it printed.
///
/// A measurement never taken is `None` rather than zero.
#[derive(Debug, Clone, PartialEq)]
pub struct ExecutionStats {
    /// CPU time the run was charged, in seconds.
    pub cpu_time: Option<f64>,
    /// Clock the run took from start to stop, in seconds.
    pub wall_time: Option<f64>,
    /// Peak memory of the run, in bytes.
    pub memory_bytes: Option<u64>,
    /// Why the run ended, and the one reason a report shows for it.
    pub exit_status: ExitStatus,
    /// The signal that killed the run, when a plain signal did.
    pub signal: Option<i64>,
    /// What the run wrote to its standard output, when it was collected.
    pub stdout: Option<String>,
    /// What the run wrote to its standard error, when it was collected.
    pub stderr: Option<String>,
}

impl ExecutionStats {
    /// What a log holds, with no output collected: the caller sets
    /// [`stdout`](Self::stdout) and [`stderr`](Self::stderr) once it has the
    /// run's own output. The signal is read for a plain signal kill alone, a
    /// memory-limit kill being reported as the limit that enforced it.
    /// # Errors
    /// [`MeasureError::Unreadable`] for any number the log cannot read.
    pub fn of(log: &ExecutionLog) -> Result<Self, MeasureError> {
        let exit_status = ExitStatus::of(log);
        let signal = match exit_status {
            ExitStatus::Signal => Some(log.killing_signal()?),
            _ => None,
        };
        Ok(Self {
            cpu_time: log.cpu_time()?,
            wall_time: log.wall_time()?,
            memory_bytes: log.memory_bytes()?,
            exit_status,
            signal,
            stdout: None,
            stderr: None,
        })
    }

    /// Folds one run's stats into the totals so far, and says how they were run.
    ///
    /// `concurrent` is the shape of the pair, not a fact about either run: two
    /// runs at once share one wall clock and one peak, so the clock is widened
    /// and the memory summed, while two in turn each get a clock of their own
    /// and one peak between them, so the clock is summed and the memory
    /// widened. CPU time is summed either way.
    ///
    /// The status reported is the first run's own, and the second's when the
    /// first returned cleanly, with the signal following it. Output already
    /// collected is joined, so several runs stay readable as several. A figure
    /// either side never measured leaves the other's alone.
    #[must_use]
    pub fn merged_with(&self, second: &Self, concurrent: bool) -> Self {
        let mut merged = self.clone();
        merged.cpu_time = summed(self.cpu_time, second.cpu_time);
        merged.exit_status = match self.exit_status {
            ExitStatus::Ok => second.exit_status,
            reported => reported,
        };
        merged.signal = match self.exit_status {
            ExitStatus::Ok => second.signal,
            _ => self.signal,
        };
        if concurrent {
            merged.wall_time = widest(self.wall_time, second.wall_time);
            merged.memory_bytes = summed(self.memory_bytes, second.memory_bytes);
        } else {
            merged.wall_time = summed(self.wall_time, second.wall_time);
            merged.memory_bytes = widest(self.memory_bytes, second.memory_bytes);
        }
        merged.stdout = joined(self.stdout.as_deref(), second.stdout.as_deref());
        merged.stderr = joined(self.stderr.as_deref(), second.stderr.as_deref());
        merged
    }
}

/// Adds two figures, where one never measured leaves the other as it is.
fn summed<T: Add<Output = T> + Copy>(first: Option<T>, second: Option<T>) -> Option<T> {
    match (first, second) {
        (Some(left), Some(right)) => Some(left + right),
        (measured, None) | (None, measured) => measured,
    }
}

/// Keeps the wider of two figures, where one never measured is not a zero.
fn widest<T: PartialOrd + Copy>(first: Option<T>, second: Option<T>) -> Option<T> {
    match (first, second) {
        (Some(left), Some(right)) => Some(if right > left { right } else { left }),
        (measured, None) | (None, measured) => measured,
    }
}

/// Joins two outputs, keeping either one that was collected on its own.
fn joined(first: Option<&str>, second: Option<&str>) -> Option<String> {
    match (first, second) {
        (Some(left), Some(right)) => Some(format!("{left}{OUTPUT_SEPARATOR}{right}")),
        (collected, None) | (None, collected) => collected.map(str::to_owned),
    }
}
