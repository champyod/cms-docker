//! The two questions a caller asks: what was sampled, and stop restarting this one.

use super::{ResourceService, PROXY_SERVICE};
use crate::resource_service::error::ResourceError;
use crate::resource_service::{Sample, ServiceCoord};

impl ResourceService<'_> {
    /// The samples newer than `last_time`, oldest first, floored at the retention window.
    #[must_use]
    pub fn get_resources(&self, last_time: f64, now: f64) -> Vec<(i64, &Sample)> {
        let floor = last_time.max(now - self.retention_seconds as f64);
        self.samples
            .iter()
            .rev()
            .filter(|(time, _)| *time as f64 > floor)
            .map(|(time, sample)| (*time, sample))
            .collect()
    }

    /// Flips one service's restart flag; `None` when this service does not supervise at all.
    ///
    /// # Errors
    ///
    /// [`ResourceError::Coord`] when `service` is not `Name,shard`, and
    /// [`ResourceError::UnknownService`] when it names no local service.
    pub fn toggle_autorestart(&mut self, service: &str) -> Result<Option<bool>, ResourceError> {
        if !self.autorestart {
            return Ok(None);
        }
        let coord = ServiceCoord::parse(service)?;
        if self.contest_id.is_none() && coord.name() == PROXY_SERVICE {
            return Ok(None);
        }
        let flag = self
            .will_restart
            .get_mut(&coord)
            .ok_or_else(|| ResourceError::UnknownService(coord.clone()))?;
        let flipped = !flag.unwrap_or(true);
        *flag = Some(flipped);
        Ok(Some(flipped))
    }
}
