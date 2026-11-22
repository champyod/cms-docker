//! The `/proc` implementation of [`ResourceReader`].

use procfs::{Current, CurrentSI, KernelStats, Meminfo};

use super::units::ticks_to_seconds;
use super::{CpuTimes, ReadError, ResourceReader, SystemFacts, SystemMemory};

/// Reads the running machine and its processes from `/proc`.
#[derive(Debug, Clone, Copy, Default)]
pub struct ProcReader;

impl ProcReader {
    /// A reader of the running machine.
    #[must_use]
    pub fn new() -> Self {
        Self
    }
}

impl ResourceReader for ProcReader {
    fn system(&self) -> Result<SystemFacts, ReadError> {
        let memory = Meminfo::current()?;
        let stats = KernelStats::current()?;
        Ok(SystemFacts {
            memory: SystemMemory {
                // WHY: procfs 0.18 multiplies meminfo's kB by 1024 while parsing, so these are
                // already bytes; converting again would report a machine 1024 times larger.
                total_bytes: memory.mem_total,
                free_bytes: memory.mem_free,
                available_bytes: memory.mem_available.unwrap_or(0),
                // WHY: psutil 7.2.2 counts SReclaimable as cached so `ram_cached` matches free(1);
                // the bare Cached line understates what the kernel can reclaim.
                cached_bytes: memory.cached + memory.s_reclaimable.unwrap_or(0),
                buffers_bytes: memory.buffers,
                swap_total_bytes: memory.swap_total,
                swap_free_bytes: memory.swap_free,
                swap_used_bytes: memory.swap_total - memory.swap_free,
            },
            cpu: CpuTimes {
                // WHY: /proc omits the fields past a kernel that predates them, and psutil reports
                // the missing counters as zero rather than failing the whole sample.
                user: ticks_to_seconds(stats.total.user),
                nice: ticks_to_seconds(stats.total.nice),
                system: ticks_to_seconds(stats.total.system),
                idle: ticks_to_seconds(stats.total.idle),
                iowait: ticks_to_seconds(stats.total.iowait.unwrap_or(0)),
                irq: ticks_to_seconds(stats.total.irq.unwrap_or(0)),
                softirq: ticks_to_seconds(stats.total.softirq.unwrap_or(0)),
                steal: ticks_to_seconds(stats.total.steal.unwrap_or(0)),
                guest: ticks_to_seconds(stats.total.guest.unwrap_or(0)),
                guest_nice: ticks_to_seconds(stats.total.guest_nice.unwrap_or(0)),
            },
            cpu_count: stats.cpu_time.len(),
        })
    }
}
