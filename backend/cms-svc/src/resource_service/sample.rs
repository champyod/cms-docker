//! What one sample says about each service, and the dict `get_resources` returns.

use std::collections::BTreeMap;

use serde_json::{json, Map, Value};

use super::coord::ServiceCoord;
use super::machine::{percent, whole_megabytes, CpuPercentages, MemoryMegabytes};
use crate::resource::ProcessFacts;

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

/// The machine and every local service at one instant.
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

#[cfg(test)]
mod tests {
    use super::{ProcessCpu, ServiceFigures};
    use crate::resource::ProcessFacts;

    fn facts(resident_bytes: u64, virtual_bytes: u64) -> ProcessFacts {
        ProcessFacts {
            pid: 1,
            cmd: Vec::new(),
            user_cpu_seconds: 0.0,
            system_cpu_seconds: 0.0,
            resident_bytes,
            virtual_bytes,
            num_threads: 2,
            uid: 0,
            create_time: 10.0,
        }
    }

    #[test]
    fn figures_use_the_integer_division_python_uses() {
        let figures = ServiceFigures::from_process(
            &facts(3_000_000, 5_000_000),
            ProcessCpu::default(),
            20.0,
            2.0,
        );

        assert_eq!(figures.resident_megabytes, 2);
        assert_eq!(figures.virtual_megabytes, 4);
        assert_eq!(figures.since, 10.0);
    }
}
