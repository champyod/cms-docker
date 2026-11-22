//! A machine and its processes as a test declares them, so no test reads the host's `/proc`.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::Duration;

use super::service::{ResourceService, Sampling};
use super::{LocalService, ServiceCoord, MAX_RESOURCE_SECONDS};
use crate::resource::{
    CpuTimes, ProcessFacts, ReadError, ResourceReader, SystemFacts, SystemMemory,
};

/// The bin directory a fixture's command lines are anchored to.
pub const BIN_PATH: &str = "/opt/cms/bin";

/// A reader over the processes a test hands it, answering nothing else.
pub struct FixtureReader {
    processes: Vec<ProcessFacts>,
}

impl FixtureReader {
    /// A machine with exactly these processes.
    #[must_use]
    pub fn with(processes: Vec<ProcessFacts>) -> Self {
        Self { processes }
    }
}

/// A resource service over a fixture machine, with these local services and this contest.
#[must_use]
pub fn service<'a>(
    reader: &'a FixtureReader,
    coords: &[(&str, i32)],
    contest_id: Option<i64>,
    autorestart: bool,
) -> ResourceService<'a> {
    let local_services = coords
        .iter()
        .map(|(name, shard)| LocalService {
            coord: ServiceCoord::new(*name, *shard),
            address: SocketAddr::from(([127, 0, 0, 1], 0)),
        })
        .collect();
    ResourceService::new(
        local_services,
        ServiceCoord::new("ResourceService", 0),
        reader,
        PathBuf::from(BIN_PATH),
        Sampling {
            interval: Duration::from_secs(5),
            retention_seconds: MAX_RESOURCE_SECONDS,
        },
        autorestart,
        contest_id,
    )
}

/// One process fact, with the figures the restart pass never reads left at zero.
#[must_use]
pub fn process(pid: i32, command: &[&str]) -> ProcessFacts {
    ProcessFacts {
        pid,
        cmd: command.iter().map(|word| (*word).to_owned()).collect(),
        user_cpu_seconds: 0.0,
        system_cpu_seconds: 0.0,
        resident_bytes: 0,
        virtual_bytes: 0,
        num_threads: 1,
        uid: 1000,
        create_time: 1.0,
    }
}

impl ResourceReader for FixtureReader {
    fn system(&self) -> Result<SystemFacts, ReadError> {
        Ok(SystemFacts {
            memory: SystemMemory {
                total_bytes: 8 << 30,
                free_bytes: 1 << 30,
                available_bytes: 1 << 30,
                cached_bytes: 0,
                buffers_bytes: 0,
                swap_total_bytes: 0,
                swap_free_bytes: 0,
                swap_used_bytes: 0,
            },
            cpu: CpuTimes::default(),
            cpu_count: 1,
        })
    }

    fn pids(&self) -> Result<Vec<i32>, ReadError> {
        Ok(self.processes.iter().map(|facts| facts.pid).collect())
    }

    fn process(&self, pid: i32) -> Result<ProcessFacts, ReadError> {
        self.processes
            .iter()
            .find(|facts| facts.pid == pid)
            .cloned()
            .ok_or(ReadError::NotFound)
    }

    fn is_running(&self, process: &ProcessFacts) -> Result<bool, ReadError> {
        // WHY: psutil compares the create time too, so a reused pid is not mistaken for the process.
        Ok(self
            .processes
            .iter()
            .any(|facts| facts.pid == process.pid && facts.create_time == process.create_time))
    }
}
