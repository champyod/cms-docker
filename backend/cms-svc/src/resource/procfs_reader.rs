//! The `/proc` implementation of [`ResourceReader`].

use procfs::process::Process;
use procfs::{Current, CurrentSI, KernelStats, Meminfo, ProcError};

use super::units::{pages_to_bytes, ticks_to_seconds};
use super::{CpuTimes, ProcessFacts, ReadError, ResourceReader, SystemFacts, SystemMemory};

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
                // WHY: procfs 0.18 multiplies meminfo's kB by 1024 while parsing, so these are already bytes.
                total_bytes: memory.mem_total,
                free_bytes: memory.mem_free,
                available_bytes: memory.mem_available.unwrap_or(0),
                // WHY: psutil 7.2.2 counts SReclaimable as cached so `ram_cached` matches free(1).
                cached_bytes: memory.cached + memory.s_reclaimable.unwrap_or(0),
                buffers_bytes: memory.buffers,
                swap_total_bytes: memory.swap_total,
                swap_free_bytes: memory.swap_free,
                swap_used_bytes: memory.swap_total - memory.swap_free,
            },
            cpu: CpuTimes {
                // WHY: /proc omits counters an older kernel lacks, and psutil reports the missing ones as zero.
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

    fn pids(&self) -> Result<Vec<i32>, ReadError> {
        let mut pids = Vec::new();
        for entry in procfs::process::all_processes()? {
            match entry {
                Ok(process) => pids.push(process.pid()),
                // WHY: a pid can vanish between readdir and open, which psutil.process_iter() skips.
                Err(ProcError::NotFound(_)) => {}
                Err(error) => return Err(ReadError::from(error)),
            }
        }
        Ok(pids)
    }

    fn process(&self, pid: i32) -> Result<ProcessFacts, ReadError> {
        let process = Process::new(pid)?;
        let stat = process.stat()?;
        let statm = process.statm()?;
        let status = process.status()?;
        Ok(ProcessFacts {
            pid,
            cmd: process.cmdline()?,
            user_cpu_seconds: ticks_to_seconds(stat.utime),
            system_cpu_seconds: ticks_to_seconds(stat.stime),
            resident_bytes: pages_to_bytes(statm.resident),
            virtual_bytes: pages_to_bytes(statm.size),
            num_threads: stat.num_threads,
            // WHY: /proc/<pid> turns root-owned for a non-dumpable process, so read Uid: as psutil does.
            uid: status.ruid,
            create_time: seconds_since_epoch(stat.starttime)?,
        })
    }

    fn is_running(&self, process: &ProcessFacts) -> Result<bool, ReadError> {
        let opened = match Process::new(process.pid) {
            Ok(opened) => opened,
            Err(error) => return alive_unless_gone(error),
        };
        let stat = match opened.stat() {
            Ok(stat) => stat,
            Err(error) => return alive_unless_gone(error),
        };
        // WHY: psutil's is_running compares start time, so a recycled pid is not the process that was read.
        Ok(seconds_since_epoch(stat.starttime)? == process.create_time)
    }
}

/// The process start time in seconds since the Unix epoch, as `psutil.Process.create_time()`.
fn seconds_since_epoch(start_ticks: u64) -> Result<f64, ReadError> {
    let boot_seconds = procfs::boot_time_secs()?;
    Ok(boot_seconds as f64 + ticks_to_seconds(start_ticks))
}

/// Maps a failed inspection to psutil's answer: gone is dead, unreadable is alive, the rest is an error.
fn alive_unless_gone(error: ProcError) -> Result<bool, ReadError> {
    match error {
        ProcError::NotFound(_) => Ok(false),
        ProcError::PermissionDenied(_) => Ok(true),
        other => Err(ReadError::from(other)),
    }
}
