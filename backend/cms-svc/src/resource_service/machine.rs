//! The machine's own figures: cpu share and memory, in the units `ResourceService.py` reports.

use serde_json::{json, Value};

use crate::resource::{CpuTimes, SystemFacts};

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

    pub(super) fn to_json(self) -> Value {
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

    pub(super) fn to_json(self) -> Value {
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

/// `int(round(seconds / delta * 100))`, with Python's half-to-even tie break.
pub(super) fn percent(seconds: f64, delta: f64) -> i64 {
    // WHY: Python's round() breaks a tie to even, so 2.5% must report 2 rather than f64::round's 3.
    (seconds / delta * 100.0).round_ties_even() as i64
}

/// Breaks bytes into a float count of mebibytes, the `/` Python uses for memory.
fn megabytes(bytes: u64) -> f64 {
    bytes as f64 / BYTES_PER_MEBIBYTE as f64
}

/// Breaks bytes into whole mebibytes, the `//` Python uses for a process's figures.
pub(super) fn whole_megabytes(bytes: u64) -> u64 {
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
        assert_eq!(percent(0.25, 2.0), 12);
        assert_eq!(percent(0.0, 2.0), 0);
    }
}
