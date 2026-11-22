//! Linux-only `/proc` facts for the resource service; [`ResourceReader`] is the swappable seam.

mod procfs_reader;
mod units;

use std::fmt;

pub use procfs_reader::ProcReader;

/// One sample of the machine's memory, in bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SystemMemory {
    /// `MemTotal`: usable RAM.
    pub total_bytes: u64,
    /// `MemFree`: RAM not in use at all.
    pub free_bytes: u64,
    /// `MemAvailable`: RAM a new workload could claim without swapping.
    pub available_bytes: u64,
    /// `Cached` plus `SReclaimable`: the page cache as `free(1)` counts it.
    pub cached_bytes: u64,
    /// `Buffers`: block-device buffers.
    pub buffers_bytes: u64,
    /// `SwapTotal`: swap the kernel has.
    pub swap_total_bytes: u64,
    /// `SwapFree`: swap nobody holds.
    pub swap_free_bytes: u64,
    /// `SwapTotal - SwapFree`: swap in use.
    pub swap_used_bytes: u64,
}

/// The ten aggregate cpu-time counters, in seconds since boot.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct CpuTimes {
    /// Time in user mode.
    pub user: f64,
    /// Time in user mode at low priority.
    pub nice: f64,
    /// Time in kernel mode.
    pub system: f64,
    /// Time doing nothing.
    pub idle: f64,
    /// Time waiting for I/O.
    pub iowait: f64,
    /// Time servicing interrupts.
    pub irq: f64,
    /// Time servicing softirqs.
    pub softirq: f64,
    /// Time stolen by a hypervisor.
    pub steal: f64,
    /// Time running a guest's virtual cpu.
    pub guest: f64,
    /// Time running a guest's niced virtual cpu.
    pub guest_nice: f64,
}

/// One sample of the machine: memory, aggregate cpu, and how many cpus produced it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SystemFacts {
    /// Memory and swap, in bytes.
    pub memory: SystemMemory,
    /// Aggregate cpu counters, in seconds.
    pub cpu: CpuTimes,
    /// Number of online cpus, the count psutil reports as `cpu_count()`.
    pub cpu_count: usize,
}

/// Everything the service reads about one process.
#[derive(Debug, Clone, PartialEq)]
pub struct ProcessFacts {
    /// Process id.
    pub pid: i32,
    /// The argument vector, as `/proc/<pid>/cmdline` states it.
    pub cmd: Vec<String>,
    /// Seconds this process spent in user mode.
    pub user_cpu_seconds: f64,
    /// Seconds this process spent in kernel mode.
    pub system_cpu_seconds: f64,
    /// Resident set size, in bytes.
    pub resident_bytes: u64,
    /// Real user id owning the process.
    pub uid: u32,
    /// Seconds since the Unix epoch at which the process started.
    pub create_time: f64,
}

/// A failed read, with the one outcome the service must branch on kept apart.
#[derive(Debug)]
pub enum ReadError {
    /// The process vanished, `psutil.NoSuchProcess`; the caller skips it rather than failing.
    NotFound,
    /// Any other failure: denied, malformed, or the filesystem is gone.
    Failed(Box<dyn std::error::Error + Send + Sync>),
}

impl fmt::Display for ReadError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound => formatter.write_str("process is gone"),
            Self::Failed(error) => write!(formatter, "cannot read process facts: {error}"),
        }
    }
}

impl std::error::Error for ReadError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::NotFound => None,
            Self::Failed(error) => Some(error.as_ref()),
        }
    }
}

impl From<procfs::ProcError> for ReadError {
    fn from(error: procfs::ProcError) -> Self {
        // WHY: psutil raises NoSuchProcess for a vanished pid and the service skips it; every other
        // failure is a real error and must not be mistaken for "gone".
        match error {
            procfs::ProcError::NotFound(_) => Self::NotFound,
            other => Self::Failed(Box::new(other)),
        }
    }
}

/// The reader the resource service depends on; `ProcReader` is the `/proc` implementation.
pub trait ResourceReader {
    /// Samples memory and aggregate cpu for the machine.
    fn system(&self) -> Result<SystemFacts, ReadError>;

    /// Lists every pid present in `/proc`, `psutil.process_iter()`.
    fn pids(&self) -> Result<Vec<i32>, ReadError>;

    /// Reads one process, or answers [`ReadError::NotFound`] if it vanished.
    fn process(&self, pid: i32) -> Result<ProcessFacts, ReadError>;

    /// Whether the pid still belongs to the process that was read, `psutil.Process.is_running()`.
    fn is_running(&self, process: &ProcessFacts) -> Result<bool, ReadError>;
}
