//! Sampling, retention, query and the restart pass: the port of `ResourceService.py`.

mod kill;
mod query;
mod restart;

use std::collections::{BTreeMap, VecDeque};
use std::path::PathBuf;
use std::time::Duration;

use crate::resource::{CpuTimes, ProcessFacts, ReadError, ResourceReader};

use super::coord::{LocalService, ServiceCoord};
use super::error::ResourceError;
use super::machine::{CpuPercentages, MemoryMegabytes};
use super::matcher::ProcessMatcher;
use super::sample::{ProcessCpu, Sample, ServiceFigures, ServiceState, ServiceUsage};

pub use kill::{ConnectorQuit, PeerQuit, QuitReceipt, QUIT_REASON, QUIT_TIMEOUT};
pub use restart::RestartReport;

use restart::Launched;

/// The window `MAX_RESOURCE_SECONDS` names: eleven minutes of samples.
pub const MAX_RESOURCE_SECONDS: i64 = 660;

/// The one service Python refuses to track without a contest id.
const PROXY_SERVICE: &str = "ProxyService";

/// How often a sample is due and how long one is kept.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Sampling {
    /// The gap between samples, which the host's timer follows.
    pub interval: Duration,
    /// The window samples are kept for, `MAX_RESOURCE_SECONDS` in the default deployment.
    pub retention_seconds: i64,
}

/// One machine's resource samples, taken from a reader the caller owns.
pub struct ResourceService<'a> {
    local_services: Vec<LocalService>,
    my_coord: ServiceCoord,
    reader: &'a dyn ResourceReader,
    bin_path: PathBuf,
    interval: Duration,
    retention_seconds: i64,
    autorestart: bool,
    contest_id: Option<i64>,
    will_restart: BTreeMap<ServiceCoord, Option<bool>>,
    procs: BTreeMap<ServiceCoord, ProcessFacts>,
    launched: Vec<Launched>,
    services_prev_cpu: BTreeMap<ServiceCoord, ProcessCpu>,
    prev_cpu: CpuTimes,
    last_saved_time: f64,
    samples: VecDeque<(i64, Sample)>,
}

impl<'a> ResourceService<'a> {
    /// Builds the service from the deployment's own facts, with no config parsing and no timer.
    ///
    /// `bin_path` is the directory the service binaries live in, Python's `BIN_PATH`, which the
    /// command-line matcher anchors to. A sample is taken once [`prime`](Self::prime) and
    /// [`sample`](Self::sample) are called with the host's clock.
    #[must_use]
    pub fn new(
        local_services: Vec<LocalService>,
        my_coord: ServiceCoord,
        reader: &'a dyn ResourceReader,
        bin_path: PathBuf,
        sampling: Sampling,
        autorestart: bool,
        contest_id: Option<i64>,
    ) -> Self {
        let mut services = local_services;
        services.sort_by(|left, right| left.coord.cmp(&right.coord));
        // WHY: Python turns autorestart on whenever a contest id exists, because the proxy needs one.
        let autorestart = autorestart || contest_id.is_some();
        let will_restart = services
            .iter()
            .map(|service| {
                let flag = if autorestart { Some(true) } else { None };
                (service.coord.clone(), flag)
            })
            .collect();
        Self {
            local_services: services,
            my_coord,
            reader,
            bin_path,
            interval: sampling.interval,
            retention_seconds: sampling.retention_seconds,
            autorestart,
            contest_id,
            will_restart,
            procs: BTreeMap::new(),
            launched: Vec::new(),
            services_prev_cpu: BTreeMap::new(),
            prev_cpu: CpuTimes::default(),
            last_saved_time: 0.0,
            samples: VecDeque::new(),
        }
    }

    /// The services this machine runs, sorted by name and shard.
    #[must_use]
    pub fn local_services(&self) -> &[LocalService] {
        &self.local_services
    }

    /// This service's own coordinate.
    #[must_use]
    pub fn my_coord(&self) -> &ServiceCoord {
        &self.my_coord
    }

    /// The gap the host's timer follows.
    #[must_use]
    pub fn interval(&self) -> Duration {
        self.interval
    }

    /// Whether `now` is at or past the next sample the interval asks for.
    #[must_use]
    pub fn is_due(&self, now: f64) -> bool {
        now - self.last_saved_time >= self.interval.as_secs_f64()
    }

    /// The constructor's store-nothing pass: fixes the starting cpu counters and finds the processes.
    ///
    /// Python calls it once from `__init__` so the first stored sample has a delta to divide by.
    ///
    /// # Errors
    ///
    /// [`ResourceError::Read`] when the machine or a process cannot be read.
    pub fn prime(&mut self, now: f64) -> Result<(), ResourceError> {
        self.last_saved_time = now;
        self.prev_cpu = self.reader.system()?.cpu;
        let matcher = ProcessMatcher::scan(self.reader, &self.bin_path)?;
        for service in &self.local_services {
            if let Some(facts) = matcher.find(&service.coord, &self.local_services) {
                self.services_prev_cpu
                    .insert(service.coord.clone(), ProcessCpu::of(facts));
                self.procs.insert(service.coord.clone(), facts.clone());
            }
        }
        Ok(())
    }

    /// Takes one sample at `now` and keeps it, dropping what fell out of the retention window.
    ///
    /// # Errors
    ///
    /// [`ResourceError::NoElapsedTime`] when two samples share an instant, and
    /// [`ResourceError::Read`] when the machine or a process cannot be read.
    pub fn sample(&mut self, now: f64) -> Result<&Sample, ResourceError> {
        let delta = now - self.last_saved_time;
        if delta <= 0.0 {
            return Err(ResourceError::NoElapsedTime);
        }
        self.last_saved_time = now;
        let system = self.reader.system()?;
        let cpu = CpuPercentages::between(&self.prev_cpu, &system.cpu, delta, system.cpu_count);
        self.prev_cpu = system.cpu;
        let memory = MemoryMegabytes::from_facts(&system);
        let services = self.sample_services(now, delta)?;
        let sample = Sample {
            cpu,
            memory,
            services,
        };
        let seconds = now as i64;
        while self
            .samples
            .back()
            .is_some_and(|(time, _)| *time < seconds - self.retention_seconds)
        {
            self.samples.pop_back();
        }
        self.samples.push_front((seconds, sample));
        Ok(&self.samples[0].1)
    }

    /// Reads every local service for this sample, marking the ones no process answered for.
    fn sample_services(
        &mut self,
        now: f64,
        delta: f64,
    ) -> Result<BTreeMap<ServiceCoord, ServiceUsage>, ResourceError> {
        let matcher = ProcessMatcher::scan(self.reader, &self.bin_path)?;
        let coords: Vec<ServiceCoord> = self
            .local_services
            .iter()
            .map(|service| service.coord.clone())
            .collect();
        let mut usage = BTreeMap::new();
        for coord in coords {
            let state = match self.live_facts(&coord, &matcher)? {
                None => ServiceState::Stopped,
                Some((facts, is_new)) => {
                    let previous = self.previous_cpu(&coord, &facts, is_new);
                    let figures = ServiceFigures::from_process(&facts, previous, now, delta);
                    self.services_prev_cpu
                        .insert(coord.clone(), ProcessCpu::of(&facts));
                    self.procs.insert(coord.clone(), facts);
                    ServiceState::Running(figures)
                }
            };
            let autorestart = self.will_restart.get(&coord).copied().flatten();
            usage.insert(coord, ServiceUsage { autorestart, state });
        }
        Ok(usage)
    }

    /// The counters this service's percentages are measured from.
    fn previous_cpu(&self, coord: &ServiceCoord, facts: &ProcessFacts, is_new: bool) -> ProcessCpu {
        if is_new {
            // WHY: a freshly matched process is measured from itself, so Python reports 0% for its first sample.
            return ProcessCpu::of(facts);
        }
        self.services_prev_cpu
            .get(coord)
            .copied()
            .unwrap_or_else(|| ProcessCpu::of(facts))
    }

    /// Fresh facts for one service, or `None` when no live process answered for it.
    fn live_facts(
        &self,
        coord: &ServiceCoord,
        matcher: &ProcessMatcher,
    ) -> Result<Option<(ProcessFacts, bool)>, ResourceError> {
        if let Some(cached) = self.procs.get(coord) {
            if self.reader.is_running(cached)? {
                return match self.reader.process(cached.pid) {
                    Ok(facts) => Ok(Some((facts, false))),
                    Err(ReadError::NotFound) => Ok(None),
                    Err(error) => Err(error.into()),
                };
            }
        }
        Ok(matcher
            .find(coord, &self.local_services)
            .cloned()
            .map(|facts| (facts, true)))
    }
}
