//! `_restart_services`: the pass that keeps the services of this machine running.

#[cfg(test)]
mod tests;

use super::{ResourceService, PROXY_SERVICE};
use crate::resource_service::error::ResourceError;
use crate::resource_service::matcher::ProcessMatcher;
use crate::resource_service::spawn::{ServiceCommand, SpawnedChild, Spawner};
use crate::resource_service::ServiceCoord;

/// The service that carries the logs; starting one by hand is the operator's call.
const LOG_SERVICE: &str = "LogService";

/// This service itself: a second copy would be both a duplicate and a supervisor of itself.
const RESOURCE_SERVICE: &str = "ResourceService";

/// What one pass did, so a caller can log a restart without re-deriving it.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct RestartReport {
    /// Children that had exited, reaped and forgotten.
    pub pruned: usize,
    /// Services started this pass, in the order they were started.
    pub spawned: Vec<ServiceCoord>,
}

/// A child this pass started, kept so the next pass can tell whether it is still running.
pub(super) struct Launched {
    pub(super) coord: ServiceCoord,
    pub(super) child: Box<dyn SpawnedChild>,
}

impl ResourceService<'_> {
    /// Prunes the children that exited, then starts every supervised service that is not running.
    ///
    /// # Errors
    ///
    /// [`ResourceError::Read`] when the process scan fails, and [`ResourceError::Spawn`] when a
    /// child cannot be started; Python raises out of the pass on either, rather than half-running it.
    pub fn restart_services(
        &mut self,
        spawner: &mut dyn Spawner,
    ) -> Result<RestartReport, ResourceError> {
        let pruned = self.prune_launched();
        let matcher = ProcessMatcher::scan(self.reader, &self.bin_path)?;
        let coords: Vec<ServiceCoord> = self
            .local_services
            .iter()
            .map(|service| service.coord.clone())
            .collect();
        let mut report = RestartReport {
            pruned,
            spawned: Vec::new(),
        };
        for coord in coords {
            if is_left_to_the_operator(coord.name(), self.contest_id) {
                continue;
            }
            if self.will_restart.get(&coord).copied().flatten() != Some(true) {
                continue;
            }
            if self.is_running(&coord, &matcher)? {
                continue;
            }
            let child = spawner.spawn(&ServiceCommand::of(
                &coord,
                &self.bin_path,
                self.contest_id,
            )?)?;
            report.spawned.push(coord.clone());
            self.launched.push(Launched { coord, child });
        }
        Ok(report)
    }

    /// Drops the children that exited, so the next decision can start that service again.
    fn prune_launched(&mut self) -> usize {
        let before = self.launched.len();
        self.launched
            .retain_mut(|launched| launched.child.is_alive());
        before - self.launched.len()
    }

    /// Whether `coord` already has a process: one this service started, or one the matcher can see.
    fn is_running(
        &mut self,
        coord: &ServiceCoord,
        matcher: &ProcessMatcher,
    ) -> Result<bool, ResourceError> {
        if self
            .launched
            .iter_mut()
            .any(|launched| launched.coord == *coord && launched.child.is_alive())
        {
            // WHY: a child we started is proof it runs, even on a scan that cannot read its command line.
            return Ok(true);
        }
        if let Some(held) = self.procs.get(coord) {
            if self.reader.is_running(held)? {
                return Ok(true);
            }
        }
        match matcher.find(coord, &self.local_services) {
            Some(facts) if self.reader.is_running(facts)? => {
                self.procs.insert(coord.clone(), facts.clone());
                Ok(true)
            }
            _ => {
                self.procs.remove(coord);
                Ok(false)
            }
        }
    }
}

/// Whether this service is one Python never starts: the operator owns it.
fn is_left_to_the_operator(name: &str, contest_id: Option<i64>) -> bool {
    matches!(name, LOG_SERVICE | RESOURCE_SERVICE)
        || (name == PROXY_SERVICE && contest_id.is_none())
}
