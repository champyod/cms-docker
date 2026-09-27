//! The states a peer is in, and the transitions between them.
//!
//! The set is closed, so a caller's question has one answer and never a guess:
//! live, backing off, cooling down, mid-dial or absent is read rather than
//! inferred. [`Dialer`] is where a socket enters, so an attempt lives here too.

use std::time::Duration;

use serde_json::Value;

use super::policy::ReconnectNotice;
use super::Connector;

/// Why one attempt did not produce a connection.
///
/// Carries a kind rather than an [`std::io::Error`] so a scripted transport can
/// say what a real socket would, and so nothing here performs I/O a test could
/// not.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DialError {
    /// Nothing answered at the address: refused, or no route to it.
    Unreachable,

    /// The attempt outlived its timeout.
    TimedOut,

    /// The peer accepted and then the connection was lost.
    Lost,

    /// The peer is administratively down, as a draining worker is.
    Unavailable,
}

impl DialError {
    /// Whether an immediate retry could plausibly succeed.
    ///
    /// A peer that is unreachable or unavailable refuses again just as fast, so
    /// a caller is told to wait out the interval rather than to dial once more
    /// inside the same step.
    #[must_use]
    pub const fn is_persistent(&self) -> bool {
        matches!(self, Self::Unreachable | Self::Unavailable)
    }
}

/// The states a peer is in, and the only ones there are.
///
/// The set is closed: every path out of a state names the state it enters, and
/// a peer that is not present never leaves [`NeverDialed`](Self::NeverDialed).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PeerState {
    /// Never dialed: a peer whose connection is opened by its first use.
    Idle,

    /// A dial is in flight, and its outcome is not known yet.
    Dialing,

    /// Connected, and the peer is carrying calls.
    Live,

    /// Not connected, waiting out the interval a failed dial earned.
    BackingOff,

    /// Not connected, and a long outage has throttled dialing to a probe.
    CoolingDown,

    /// Not present in the configuration, so it is never dialed.
    ///
    /// This is what `connect_to` answers with a fake client for, stated rather
    /// than faked: the peer is absent, and a call to it is refused instead of
    /// silently discarded.
    NeverDialed,
}

/// A connection the connector can hand calls to.
pub trait PeerSession {
    /// Writes one envelope, framed however this transport frames.
    ///
    /// # Errors
    ///
    /// Whatever the transport reports, as a [`DialError`]: a write that failed
    /// is a connection that is gone, which the connector handles itself.
    fn write(&mut self, envelope: &Value) -> Result<(), DialError>;
}

/// What the host provides so a dial can be attempted.
///
/// This trait is the only way a socket enters the crate, which is what lets the
/// whole state machine run offline: a scripted implementation answers with
/// whatever the test says the peer does. It is taken by reference so one
/// implementation can serve every peer the host owns.
pub trait Dialer {
    /// Attempts one connection.
    ///
    /// # Errors
    ///
    /// [`DialError`] when no connection was established. A connection that was
    /// established and then dropped is reported as [`DialError::Lost`], so one
    /// failed attempt is banked the same way whichever half of it failed.
    fn dial(&mut self) -> Result<Box<dyn PeerSession>, DialError>;
}

impl Connector {
    /// Records the end of a connection the host's read loop saw break.
    ///
    /// The peer goes back to due at `now` rather than waiting out an interval:
    /// a connection that is already gone has not earned a backoff yet, and the
    /// Python loop re-dials as soon as its read breaks and only then starts
    /// waiting. The outage counters start from zero for the same reason — the
    /// peer was up, so this is a fresh outage rather than a long one.
    pub fn lost(&mut self, reason: DialError, now: Duration) {
        self.session = None;
        self.state = PeerState::BackingOff;
        self.retry_at = Some(now);
        self.retry_delay = Duration::ZERO;
        self.failures = 0;
        self.capped_intervals = 0;
        self.last_failure = Some(reason);
    }

    /// Advances the peer to `now`, dialing if one is due, and reports an outage.
    ///
    /// A peer that has never been dialed is left alone: its connection is
    /// opened by its first use, so a background tick cannot make this service
    /// depend on a peer it has not asked for yet. A connection that came up is
    /// read from [`Self::state`] rather than reported, because the host dialled
    /// and already knows, and a notice on every recovery is the noise the
    /// throttle exists to remove.
    pub fn poll<T: Dialer>(
        &mut self,
        transport: &mut T,
        now: Duration,
        jitter: f64,
    ) -> Option<ReconnectNotice> {
        self.open_due(transport, now, jitter);
        let reason = self.last_failure?;
        if self.is_live() || !self.is_waiting() {
            return None;
        }
        self.note_is_due(now).then_some(ReconnectNotice {
            failures: self.failures,
            delay: self.retry_delay,
            reason,
        })
    }

    /// Attempts one connection, keeping it or banking the failure.
    pub(super) fn dial<T: Dialer>(&mut self, transport: &mut T, now: Duration, jitter: f64) {
        self.state = PeerState::Dialing;
        self.session = None;
        match transport.dial() {
            Ok(session) => {
                self.session = Some(session);
                self.state = PeerState::Live;
                self.reset_failures();
            }
            Err(reason) => self.bank_failure(reason, now, jitter),
        }
    }

    /// Turns a refused attempt into the interval the next one waits for.
    fn bank_failure(&mut self, reason: DialError, now: Duration, jitter: f64) {
        self.failures = self.failures.saturating_add(1);
        self.last_failure = Some(reason);
        self.retry_delay = self.policy.interval(self.failures, jitter);
        self.capped_intervals = if self.retry_delay >= self.policy.max {
            self.capped_intervals.saturating_add(1)
        } else {
            0
        };
        if self.is_breaker_armed() {
            self.retry_delay = self.policy.cooldown;
            self.state = PeerState::CoolingDown;
        } else {
            self.state = PeerState::BackingOff;
        }
        self.retry_at = Some(now + self.retry_delay);
    }
}
