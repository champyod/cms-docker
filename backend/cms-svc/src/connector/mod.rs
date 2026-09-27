//! One peer, kept up: the state machine a supervised connector owns.
//!
//! `RemoteServiceClient._run` keeps a connection to one peer up forever — it
//! dials, and on failure waits a capped, jittered interval and dials again,
//! probing more slowly once the outage lasts. That loop holds four numbers and
//! no owner, so a peer being dialed for the first time is indistinguishable
//! from one being retried, and a missing optional peer is faked with a client
//! that silently discards every call.
//!
//! [`Connector`] gives one peer a state to be in — [`PeerState`] — and refuses
//! to guess. A peer dialed for the first time, one waiting out a backoff, one
//! cooling down and one not present at all are four answers a caller can act
//! on, and only one of them ever reaches the transport. Nothing here opens a
//! socket: [`Dialer`] is the seam, so the whole machine runs against a
//! scripted transport and a clock the host passes in, and no runtime decides
//! when a dial happens.
//!
//! # Errors
//!
//! A peer being down is the case this module exists for, so a refused dial is a
//! state transition rather than an error the caller handles. What is reported
//! instead of swallowed: [`NoRoute`] from [`Connector::send`], which separates a
//! refusal to dial a peer from a refusal to queue on it, and [`Send::Dropped`],
//! which is the one message shape a connection cannot answer at all.
//!
//! The three halves are [`state`], the states a peer is in and the transitions
//! between them, [`policy`], the numbers every interval and every notice is
//! built from, and [`send`], what one message costs a connection and the refusal
//! a caller gets instead.

mod policy;
mod send;
mod state;

use std::time::Duration;

pub use policy::{BackoffPolicy, ReconnectNotice};
pub use send::{of_dispatch, of_frame, NoRoute, Send};
pub use state::{DialError, Dialer, PeerSession, PeerState};

/// One supervised connection to one peer.
///
/// Owned by the host and advanced by [`Self::poll`], which takes the clock as an
/// argument: no timer and no runtime, so a host that owns the clock decides
/// exactly when a dial happens.
pub struct Connector {
    peer: String,
    policy: BackoffPolicy,
    state: PeerState,
    session: Option<Box<dyn PeerSession>>,
    failures: u32,
    capped_intervals: u32,
    retry_at: Option<Duration>,
    retry_delay: Duration,
    last_failure: Option<DialError>,
    last_notice: Option<Duration>,
    next_id: u64,
}

impl Connector {
    /// Takes a peer, given the numbers its backoff is built from.
    ///
    /// An optional peer starts in [`PeerState::NeverDialed`] and is never
    /// dialed; any other peer starts in [`PeerState::Idle`] and is dialed by
    /// its first use.
    #[must_use]
    pub fn new(peer: impl Into<String>, policy: BackoffPolicy) -> Self {
        let state = if policy.is_optional {
            PeerState::NeverDialed
        } else {
            PeerState::Idle
        };
        Self {
            peer: peer.into(),
            policy,
            state,
            session: None,
            failures: 0,
            capped_intervals: 0,
            retry_at: None,
            retry_delay: Duration::ZERO,
            last_failure: None,
            last_notice: None,
            next_id: 0,
        }
    }

    /// The name this peer is known by, for a notice that has to name it.
    #[must_use]
    pub fn peer(&self) -> &str {
        &self.peer
    }

    /// The state the peer is in.
    #[must_use]
    pub const fn state(&self) -> PeerState {
        self.state
    }

    /// Whether a call would reach the peer without waiting.
    #[must_use]
    pub const fn is_live(&self) -> bool {
        matches!(self.state, PeerState::Live)
    }

    /// Whether the peer is absent, so no dial will ever be attempted.
    #[must_use]
    pub const fn is_absent(&self) -> bool {
        matches!(self.state, PeerState::NeverDialed)
    }

    /// How long until the next dial is due, zero when one is due now.
    #[must_use]
    pub fn next_dial_in(&self, now: Duration) -> Duration {
        self.retry_at
            .map_or(Duration::ZERO, |at| at.saturating_sub(now))
    }

    /// Puts a peer that answered back where a healthy peer starts.
    pub(super) const fn reset_failures(&mut self) {
        self.failures = 0;
        self.capped_intervals = 0;
        self.retry_at = None;
        self.retry_delay = Duration::ZERO;
        self.last_failure = None;
    }

    /// Whether a long outage has throttled dialing down to a probe.
    pub(super) const fn is_breaker_armed(&self) -> bool {
        self.capped_intervals > self.policy.trip_after
    }

    /// Whether the peer is waiting out an interval rather than needing a dial.
    pub(super) const fn is_waiting(&self) -> bool {
        matches!(self.state, PeerState::BackingOff | PeerState::CoolingDown)
    }

    /// Whether a background dial is owed: an interval that ended just now.
    pub(super) fn is_due(&self, now: Duration) -> bool {
        let is_waiting = self.is_waiting();
        is_waiting && self.next_dial_in(now).is_zero()
    }
}
