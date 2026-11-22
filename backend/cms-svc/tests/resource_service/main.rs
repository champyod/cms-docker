//! The sampling half of `ResourceService`, driven by a fake reader and a fake clock.

mod matcher;
mod retention;
mod sampling;
mod services;
mod toggling;

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::Duration;

use cms_svc::{
    CpuTimes, LocalService, ProcessFacts, ReadError, ResourceReader, ResourceService, Sampling,
    ServiceCoord, SystemFacts, SystemMemory, MAX_RESOURCE_SECONDS,
};

/// The directory the fake command lines name, Python's `BIN_PATH`.
pub(crate) const BIN: &str = "/opt/cms/bin";

pub(crate) const MEBIBYTE: u64 = 1024 * 1024;

pub(crate) const GIBIBYTE: u64 = 1024 * MEBIBYTE;

/// A machine whose memory, counters and processes the test sets.
pub(crate) struct FakeReader {
    system: RefCell<SystemFacts>,
    processes: RefCell<BTreeMap<i32, ProcessFacts>>,
}

impl FakeReader {
    pub(crate) fn new() -> Self {
        Self {
            system: RefCell::new(system_facts(counters(10.0, 0.0, 20.0, 70.0))),
            processes: RefCell::new(BTreeMap::new()),
        }
    }

    pub(crate) fn set_cpu(&self, cpu: CpuTimes) {
        self.system.borrow_mut().cpu = cpu;
    }

    pub(crate) fn put_process(&self, facts: ProcessFacts) {
        self.processes.borrow_mut().insert(facts.pid, facts);
    }

    pub(crate) fn remove_process(&self, pid: i32) {
        self.processes.borrow_mut().remove(&pid);
    }
}

impl ResourceReader for FakeReader {
    fn system(&self) -> Result<SystemFacts, ReadError> {
        Ok(*self.system.borrow())
    }

    fn pids(&self) -> Result<Vec<i32>, ReadError> {
        Ok(self.processes.borrow().keys().copied().collect())
    }

    fn process(&self, pid: i32) -> Result<ProcessFacts, ReadError> {
        self.processes
            .borrow()
            .get(&pid)
            .cloned()
            .ok_or(ReadError::NotFound)
    }

    fn is_running(&self, process: &ProcessFacts) -> Result<bool, ReadError> {
        Ok(self.processes.borrow().contains_key(&process.pid))
    }
}

pub(crate) fn counters(user: f64, nice: f64, system: f64, idle: f64) -> CpuTimes {
    CpuTimes {
        user,
        nice,
        system,
        idle,
        iowait: 0.0,
        irq: 0.0,
        softirq: 0.0,
        steal: 0.0,
        guest: 0.0,
        guest_nice: 0.0,
    }
}

pub(crate) fn memory() -> SystemMemory {
    SystemMemory {
        total_bytes: 8 * GIBIBYTE,
        free_bytes: 2 * GIBIBYTE,
        available_bytes: 3 * GIBIBYTE,
        cached_bytes: GIBIBYTE,
        buffers_bytes: GIBIBYTE / 2,
        swap_total_bytes: 2 * GIBIBYTE,
        swap_free_bytes: 3 * GIBIBYTE / 2,
        swap_used_bytes: GIBIBYTE / 2,
    }
}

pub(crate) fn system_facts(cpu: CpuTimes) -> SystemFacts {
    SystemFacts {
        memory: memory(),
        cpu,
        cpu_count: 4,
    }
}

pub(crate) fn local(name: &str, shard: i32) -> LocalService {
    LocalService {
        coord: ServiceCoord::new(name, shard),
        address: "127.0.0.1:8888".parse::<SocketAddr>().unwrap(),
    }
}

pub(crate) fn process(
    pid: i32,
    command: &[&str],
    user_cpu_seconds: f64,
    system_cpu_seconds: f64,
    resident_bytes: u64,
    create_time: f64,
) -> ProcessFacts {
    ProcessFacts {
        pid,
        cmd: command.iter().map(|part| (*part).to_owned()).collect(),
        user_cpu_seconds,
        system_cpu_seconds,
        resident_bytes,
        virtual_bytes: 5_000_000,
        num_threads: 3,
        uid: 1000,
        create_time,
    }
}

pub(crate) fn build<'a>(
    reader: &'a FakeReader,
    services: Vec<LocalService>,
    autorestart: bool,
    contest_id: Option<i64>,
) -> ResourceService<'a> {
    ResourceService::new(
        services,
        ServiceCoord::new("ResourceService", 0),
        reader,
        PathBuf::from(BIN),
        Sampling {
            interval: Duration::from_secs(5),
            retention_seconds: MAX_RESOURCE_SECONDS,
        },
        autorestart,
        contest_id,
    )
}
