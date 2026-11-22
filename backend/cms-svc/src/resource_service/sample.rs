//! What one sample says about the machine, in the shapes `ResourceService.py` reports.

use std::collections::BTreeMap;

use serde_json::{json, Map, Value};

use super::coord::ServiceCoord;
use crate::resource::{CpuTimes, ProcessFacts, SystemFacts};

/// Bytes in a mebibyte, the divisor `B_TO_MB` names.
const BYTES_PER_MEBIBYTE: u64 = 1024 * 1024;

/// The machine's cpu share since the previous sample, in whole percent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CpuPercentages {
    /// Percent of a single cpu spent in user mode.
    pub user: i64,
    /// Percent spent in user mode at low priority.
    pub nice: i64,
    /// Percent spent in kernel mode.
    pub system: i64,
    /// Percent spent doing nothing.
    pub idle: i64,
    /// Percent spent waiting for I/O.
    pub iowait: i64,
    /// Percent spent servicing interrupts.
    pub irq: i64,
    /// Percent spent servicing softirqs.
    pub softirq: i64,
    /// Online cpus, which is what the percentages are per.
    pub num_cpu: usize,
}

impl CpuPercentages {
    /// Converts two counter readings into the percentages Python reports for `delta` seconds.
    #[must_use]
    pub fn between(previous: &CpuTimes, current: &CpuTimes, delta: f64, num_cpu: usize) -> Self {
        Self {
            user: percent(current.user - previous.user, delta),
            nice: percent(current.nice - previous.nice, delta),
            system: percent(current.system - previous.system, delta),
            idle: percent(current.idle - previous.idle, delta),
            iowait: percent(current.iowait - previous.iowait, delta),
            irq: percent(current.irq - previous.irq, delta),
            softirq: percent(current.softirq - previous.softirq, delta),
            num_cpu,
        }
    }

    fn to_json(self) -> Value {
        json!({
            "user": self.user,
            "nice": self.nice,
            "system": self.system,
            "idle": self.idle,
            "iowait": self.iowait,
            "irq": self.irq,
            "softirq": self.softirq,
            "num_cpu": self.num_cpu,
        })
    }
}

/// The machine's memory in mebibytes, each a float division exactly as `ResourceService.py:341-348`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MemoryMegabytes {
    /// Total RAM.
    pub ram_total: f64,
    /// RAM not in use at all; Python reads `vmem.free`, not `vmem.available`.
    pub ram_available: f64,
    /// Page cache.
    pub ram_cached: f64,
    /// Block-device buffers.
    pub ram_buffers: f64,
    /// Total minus free, buffers and cached, which is how psutil defines `used`.
    pub ram_used: f64,
    /// Swap the kernel has.
    pub swap_total: f64,
    /// Swap nobody holds, Python's `swap.free`.
    pub swap_available: f64,
    /// Swap in use.
    pub swap_used: f64,
}

impl MemoryMegabytes {
    /// Scales one system reading into the eight figures Python reports.
    #[must_use]
    pub fn from_facts(facts: &SystemFacts) -> Self {
        let memory = &facts.memory;
        // WHY: the reader exposes no `used`, and psutil defines it as total − free − buffers − cached.
        let used = memory
            .total_bytes
            .saturating_sub(memory.free_bytes)
            .saturating_sub(memory.buffers_bytes)
            .saturating_sub(memory.cached_bytes);
        Self {
            ram_total: megabytes(memory.total_bytes),
            ram_available: megabytes(memory.free_bytes),
            ram_cached: megabytes(memory.cached_bytes),
            ram_buffers: megabytes(memory.buffers_bytes),
            ram_used: megabytes(used),
            swap_total: megabytes(memory.swap_total_bytes),
            swap_available: megabytes(memory.swap_free_bytes),
            swap_used: megabytes(memory.swap_used_bytes),
        }
    }

    fn to_json(self) -> Value {
        json!({
            "ram_total": self.ram_total,
            "ram_available": self.ram_available,
            "ram_cached": self.ram_cached,
            "ram_buffers": self.ram_buffers,
            "ram_used": self.ram_used,
            "swap_total": self.swap_total,
            "swap_available": self.swap_available,
            "swap_used": self.swap_used,
        })
    }
}

/// What one service is doing, and whether an autorestarting supervisor would restart it.
#[derive(Debug, Clone, PartialEq)]
pub struct ServiceUsage {
    /// `None` when autorestart is off for the whole service, otherwise the per-service flag.
    pub autorestart: Option<bool>,
    /// Whether the process was found, and its figures when it was.
    pub state: ServiceState,
}

/// The two answers a report can give about a service.
#[derive(Debug, Clone, PartialEq)]
pub enum ServiceState {
    /// The process is running, with the figures read this sample.
    Running(ServiceFigures),
    /// No process matched, so no figure is reported rather than a stale one.
    Stopped,
}

/// One running service's figures, already in the units Python reports.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ServiceFigures {
    /// Seconds since the process started, measured at the sample's precise time.
    pub since: f64,
    /// Resident set size in whole mebibytes: Python's `//`.
    pub resident_megabytes: u64,
    /// Virtual memory in whole mebibytes: Python's `//`.
    pub virtual_megabytes: u64,
    /// Percent of a single cpu spent in user mode since the previous sample.
    pub user: i64,
    /// Percent of a single cpu spent in kernel mode since the previous sample.
    pub sys: i64,
    /// Threads in the process.
    pub threads: i64,
}

impl ServiceFigures {
    /// Reads one process's figures, percentages being taken since `previous`.
    #[must_use]
    pub fn from_process(facts: &ProcessFacts, previous: ProcessCpu, now: f64, delta: f64) -> Self {
        Self {
            since: now - facts.create_time,
            resident_megabytes: whole_megabytes(facts.resident_bytes),
            virtual_megabytes: whole_megabytes(facts.virtual_bytes),
            user: percent(facts.user_cpu_seconds - previous.user, delta),
            sys: percent(facts.system_cpu_seconds - previous.system, delta),
            threads: facts.num_threads,
        }
    }
}

/// A process's cpu counters at one sample, the `(user, system)` pair Python keeps per service.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct ProcessCpu {
    /// Seconds in user mode.
    pub user: f64,
    /// Seconds in kernel mode.
    pub system: f64,
}

impl ProcessCpu {
    /// Takes the pair from one process reading.
    #[must_use]
    pub fn of(facts: &ProcessFacts) -> Self {
        Self {
            user: facts.user_cpu_seconds,
            system: facts.system_cpu_seconds,
        }
    }
}

impl ServiceUsage {
    fn to_json(&self) -> Value {
        match &self.state {
            ServiceState::Stopped => json!({
                "autorestart": self.autorestart,
                "running": false,
            }),
            ServiceState::Running(figures) => json!({
                "autorestart": self.autorestart,
                "running": true,
                "since": figures.since,
                "resident": figures.resident_megabytes,
                "virtual": figures.virtual_megabytes,
                "user": figures.user,
                "sys": figures.sys,
                "threads": figures.threads,
            }),
        }
    }
}

/// One stored sample: the machine and every local service at one instant.
#[derive(Debug, Clone, PartialEq)]
pub struct Sample {
    /// Cpu share since the previous sample.
    pub cpu: CpuPercentages,
    /// Memory at this sample.
    pub memory: MemoryMegabytes,
    /// Every local service, keyed the way Python keys it.
    pub services: BTreeMap<ServiceCoord, ServiceUsage>,
}

impl Sample {
    /// The dict shape `_store_resources` stores and `get_resources` returns.
    #[must_use]
    pub fn to_json(&self) -> Value {
        let services: Map<String, Value> = self
            .services
            .iter()
            .map(|(coord, usage)| (coord.to_string(), usage.to_json()))
            .collect();
        json!({
            "cpu": self.cpu.to_json(),
            "memory": self.memory.to_json(),
            "services": Value::Object(services),
        })
    }
}

/// `int(round(seconds / delta * 100))`, with Python's half-to-even tie break.
fn percent(seconds: f64, delta: f64) -> i64 {
    // WHY: Python's round() breaks a tie to even, so 2.5% must report 2 rather than f64::round's 3.
    (seconds / delta * 100.0).round_ties_even() as i64
}

/// Breaks bytes into a float count of mebibytes, the `/` Python uses for memory.
pub(crate) fn megabytes(bytes: u64) -> f64 {
    bytes as f64 / BYTES_PER_MEBIBYTE as f64
}

/// Breaks bytes into whole mebibytes, the `//` Python uses for a process's figures.
pub(crate) fn whole_megabytes(bytes: u64) -> u64 {
    bytes / BYTES_PER_MEBIBYTE
}

#[cfg(test)]
mod tests {
    use super::{megabytes, percent, whole_megabytes};

    #[test]
    fn memory_is_a_float_division() {
        assert_eq!(megabytes(1_048_576), 1.0);
        assert_eq!(megabytes(3_000_000), 3_000_000_f64 / 1_048_576_f64);
    }

    #[test]
    fn process_memory_is_an_integer_division() {
        assert_eq!(whole_megabytes(1_048_576), 1);
        assert_eq!(whole_megabytes(3_000_000), 2);
        assert_eq!(whole_megabytes(1_048_575), 0);
    }

    #[test]
    fn percentages_round_like_python() {
        assert_eq!(percent(0.5, 2.0), 25);
        assert_eq!(percent(0.05, 2.0), 2);
        assert_eq!(percent(0.07, 2.0), 4);
        assert_eq!(percent(0.0, 2.0), 0);
    }
}
