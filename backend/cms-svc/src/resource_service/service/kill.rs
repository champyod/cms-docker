//! `kill_service`: ask one peer to quit, on the operator's word.

#[cfg(test)]
mod tests;

use std::time::Duration;

use serde_json::json;

use super::ResourceService;
use crate::connector::{BackoffPolicy, Connector, Dialer, NoRoute};
use crate::resource_service::error::ResourceError;
use crate::resource_service::ServiceCoord;

/// The wait Python spends in `wait_for_connection(timeout=5)` before calling the quit.
pub const QUIT_TIMEOUT: Duration = Duration::from_secs(5);

/// The reason every kill carries, spelled as the Python service spells it.
pub const QUIT_REASON: &str = "Asked by ResourceService";

/// The method the peer is asked for.
const QUIT_METHOD: &str = "quit";

/// The keyword argument the reason travels in.
const REASON_KEY: &str = "reason";

/// The only jitter a single call may have, so a test can predict the envelope.
const NO_JITTER: f64 = 0.0;

/// The id a peer's answer to the quit is correlated with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QuitReceipt {
    /// The `__id` the reply carries back, as the connector wrote it.
    pub call_id: String,
}

/// Asking one peer to quit: the one thing a kill needs a connection for.
pub trait PeerQuit {
    /// Calls `quit` on the peer at `coord`, waiting at most `timeout` for the connection.
    ///
    /// # Errors
    ///
    /// [`NoRoute`] when the peer is absent, or did not come up inside the timeout.
    fn quit(
        &mut self,
        coord: &ServiceCoord,
        reason: &str,
        timeout: Duration,
    ) -> Result<QuitReceipt, NoRoute>;
}

impl ResourceService<'_> {
    /// Asks one service to quit, named `Name,shard` as the RPC argument spells it.
    ///
    /// # Errors
    ///
    /// [`ResourceError::Coord`] when the string is not `Name,shard`, and [`ResourceError::Quit`]
    /// when the peer refused the call. Python logs an undecodable string and reads on from the
    /// index of a split that failed, which is how it kills the wrong service; a typed error is
    /// the only answer that does not carry that index.
    pub fn kill_service(
        &self,
        service: &str,
        peer: &mut dyn PeerQuit,
    ) -> Result<QuitReceipt, ResourceError> {
        let coord = ServiceCoord::parse(service)?;
        peer.quit(&coord, QUIT_REASON, QUIT_TIMEOUT)
            .map_err(|reason| ResourceError::Quit { coord, reason })
    }
}

/// The production quit: one `quit` call written through the crate's connector.
pub struct ConnectorQuit<'a, D: Dialer> {
    dialer: &'a mut D,
    now: Duration,
}

impl<'a, D: Dialer> ConnectorQuit<'a, D> {
    /// Writes the call over the transport the host owns, at the instant the host's clock says.
    pub fn new(dialer: &'a mut D, now: Duration) -> Self {
        Self { dialer, now }
    }
}

impl<D: Dialer> PeerQuit for ConnectorQuit<'_, D> {
    fn quit(
        &mut self,
        coord: &ServiceCoord,
        reason: &str,
        timeout: Duration,
    ) -> Result<QuitReceipt, NoRoute> {
        // WHY: the connector dials before it writes, so one send is one attempt inside this deadline.
        let policy = BackoffPolicy {
            base: timeout,
            max: timeout,
            ..BackoffPolicy::default()
        };
        let mut peer = Connector::new(coord.to_string(), policy);
        let data = json!({ REASON_KEY: reason });
        peer.send(QUIT_METHOD, &data, self.dialer, self.now, NO_JITTER)
            .map(|call_id| QuitReceipt { call_id })
    }
}
