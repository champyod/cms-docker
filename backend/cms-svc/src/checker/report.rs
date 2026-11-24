//! What one checker round saw, per peer and in aggregate.

use crate::ServiceCoord;

use super::CheckerError;

/// The outcome for one configured peer.
#[derive(Debug)]
pub struct PeerCheck {
    /// The identity the table gave this peer.
    pub coord: ServiceCoord,
    /// Seconds spent on the outbound call, when the peer answered.
    pub latency: Option<f64>,
    /// Whether the answer's timestamp was more than ten seconds old.
    pub late: bool,
    /// The dial, call, or answer failure, when one happened.
    pub error: Option<CheckerError>,
}

/// Every peer visited by one round, with counts derived from those visits.
#[derive(Debug, Default)]
pub struct CheckReport {
    /// How many configured peers were checked, including failures.
    pub checked: usize,
    /// How many answers were older than ten seconds.
    pub late: usize,
    /// How many peers failed to dial, answer, or answer usably.
    pub failed: usize,
    /// Per-peer outcomes in the order the service table gave them.
    pub peers: Vec<PeerCheck>,
}

impl CheckReport {
    /// Records one peer without letting the aggregate counts drift from its outcomes.
    pub(super) fn push(&mut self, peer: PeerCheck) {
        self.checked += 1;
        self.late += usize::from(peer.late);
        self.failed += usize::from(peer.error.is_some());
        self.peers.push(peer);
    }
}
