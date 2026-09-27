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

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::time::Duration;

use cms_proto::{error as refusal_envelope, Decision, Response};
use serde_json::{json, Value};

/// Backoff base the Python client is constructed with by `connect_to`.
const DEFAULT_BASE: Duration = Duration::from_millis(500);

/// Ceiling on one backoff interval, `RemoteServiceClient.RETRY_MAX_INTERVAL`.
const DEFAULT_MAX: Duration = Duration::from_secs(30);

/// Consecutive capped intervals that arm the breaker, `BREAKER_CAPPED_WAITS`.
const DEFAULT_TRIP_AFTER: u32 = 3;

/// Interval the breaker probes at, `RemoteServiceClient.BREAKER_COOLDOWN`.
const DEFAULT_COOLDOWN: Duration = Duration::from_secs(120);

/// Shortest gap between two notices past the opening burst, `RETRY_LOG_INTERVAL`.
const DEFAULT_NOTICE_EVERY: Duration = Duration::from_secs(60);

/// Notices emitted before throttling starts, `_log_retry`'s `failures <= 3`.
const NOTICE_BURST: u32 = 3;

/// Key the id a reply is correlated with, spelled as the wire spells it.
const ID_KEY: &str = "__id";

/// Key the called method is named under.
const METHOD_KEY: &str = "__method";

/// Key the keyword arguments are carried under.
const DATA_KEY: &str = "__data";

/// Answer for a frame whose `__data` is not an object.
///
/// `rpc.py` reaches this case by expanding a non-mapping as keyword arguments
/// and reports a Python traceback, which no other language can reproduce
/// honestly; the caller is told the one fact it can act on instead.
const DATA_NOT_AN_OBJECT: &str = "__data is not an object.";

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

/// One reconnect notice, emitted at most once per interval.
///
/// The count, the interval and the reason are all the notice says, so writing
/// it needs nothing else looked up: the throttle is what keeps a four-hour
/// outage from writing a line per attempt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReconnectNotice {
    /// Consecutive failed attempts, reset by a dial that connected.
    pub failures: u32,

    /// The interval now being waited out, jitter included.
    pub delay: Duration,

    /// Why the last attempt did not connect.
    pub reason: DialError,
}

/// What the connection owes the peer about one message.
#[derive(Debug, Clone, PartialEq)]
pub enum Send {
    /// Write this whole answer: a refusal or a result, keyed with the id the
    /// caller is waiting on.
    Answer(Response),

    /// The message carries no id a reply could be keyed with, so there is
    /// nothing to answer and the connection ends — the drop
    /// [`Decision::Dropped`] reports, and the frame layer reports its own.
    Dropped,
}

/// Renders the answer the connection owes one message the dispatch gate decided.
///
/// # Errors
///
/// None. A drop is `Send::Dropped` and an answer is `Send::Answer`; framing
/// belongs to the host, which owns the socket and the codec.
#[must_use]
pub fn of_dispatch(decision: &Decision) -> Send {
    match decision {
        Decision::Dropped(_) => Send::Dropped,
        Decision::Answered(response) => Send::Answer(response.clone()),
    }
}

/// Renders the answer the connection owes one frame the dispatch gate never saw.
///
/// A frame the codec read but could not hand over still holds the `__id` its
/// sender is waiting on, so a frame with one is refused and a frame with none
/// is dropped, which is the split [`of_dispatch`] makes one layer later.
///
/// # Errors
///
/// None, for the same reason as [`of_dispatch`].
#[must_use]
pub fn of_frame(value: &Value) -> Send {
    let Some(id) = value.get(ID_KEY).and_then(Value::as_str) else {
        return Send::Dropped;
    };
    Send::Answer(refusal_envelope(id, DATA_NOT_AN_OBJECT))
}

/// The numbers one peer's backoff is built from.
///
/// The defaults are the ones `connect_to` uses: a half-second base and the caps
/// `RemoteServiceClient` declares, so a peer given nothing backs off as the
/// Python client would.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BackoffPolicy {
    /// Interval for the first failure; every one after doubles it.
    pub base: Duration,

    /// Ceiling for one interval, jitter included.
    pub max: Duration,

    /// Consecutive capped intervals before the breaker arms.
    pub trip_after: u32,

    /// Interval the breaker probes at instead of the capped one.
    pub cooldown: Duration,

    /// Shortest gap between two notices past the opening burst.
    pub notice_every: Duration,

    /// Whether the peer may be absent. Absent is never dialed.
    pub is_optional: bool,
}

impl Default for BackoffPolicy {
    fn default() -> Self {
        Self {
            base: DEFAULT_BASE,
            max: DEFAULT_MAX,
            trip_after: DEFAULT_TRIP_AFTER,
            cooldown: DEFAULT_COOLDOWN,
            notice_every: DEFAULT_NOTICE_EVERY,
            is_optional: false,
        }
    }
}

impl BackoffPolicy {
    /// A policy for a peer whose absence is expected and harmless.
    #[must_use]
    pub const fn optional() -> Self {
        Self {
            base: DEFAULT_BASE,
            max: DEFAULT_MAX,
            trip_after: DEFAULT_TRIP_AFTER,
            cooldown: DEFAULT_COOLDOWN,
            notice_every: DEFAULT_NOTICE_EVERY,
            is_optional: true,
        }
    }

    /// The interval for the n-th consecutive failure, jitter included.
    ///
    /// Doubling stops at `max` and the jitter is folded in under that same
    /// ceiling, so an interval is bounded and never zero: two peers that lost
    /// the same upstream do not retry in lockstep.
    #[must_use]
    pub fn interval(&self, failures: u32, jitter: f64) -> Duration {
        let factor = 1u32
            .checked_shl(failures.saturating_sub(1))
            .unwrap_or(u32::MAX);
        let ceiling = self.base.saturating_mul(factor).min(self.max);
        let span = self
            .base
            .min(self.max.saturating_sub(ceiling))
            .as_secs_f64();
        ceiling + Duration::from_secs_f64(span * fraction(jitter))
    }
}

/// A jitter the caller can have meant, with everything else refused to zero.
///
/// The unit interval is the whole contract, and a value outside it is not a
/// smaller jitter but a different request, so it gets no jitter rather than a
/// wrong one. A `NaN` lies outside the interval too, which is what keeps the
/// conversion above from ever meeting one.
fn fraction(jitter: f64) -> f64 {
    if !(0.0..=1.0).contains(&jitter) {
        return 0.0;
    }
    jitter
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

/// Why a peer cannot carry a call.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NoRoute {
    /// The peer is not in the configuration, so nothing may be dialed to it.
    Absent,

    /// The peer is known but not connected, and no dial is due yet.
    ///
    /// A first use dials on the spot; every later refusal waits for the
    /// interval the last failure earned, so asking twice cannot turn the
    /// backoff into a dial storm.
    NotConnected {
        /// The state the peer is in, so a caller can tell a backoff from a
        /// cooldown, and a first use from a connection.
        state: PeerState,

        /// How long until a dial is due.
        due_in: Duration,
    },
}

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

    /// Sends one call, dialing first if the peer is idle and due.
    ///
    /// A first use dials on the spot rather than waiting for the next poll, so
    /// a caller that just connected and already has work does not spend a
    /// second round trip learning the peer answered. An ended interval is
    /// honoured here too, so a call made the instant a connection dropped goes
    /// out on the re-dial instead of being refused.
    ///
    /// # Errors
    ///
    /// [`NoRoute::Absent`] when the peer is not in the configuration, and
    /// [`NoRoute::NotConnected`] when it is known but not live: a dial that just
    /// failed, or an interval that has not ended. The connection is never
    /// abandoned to make room for a new call, so a peer with no route refuses
    /// rather than dropping what it already holds.
    pub fn send<T: Dialer>(
        &mut self,
        method: &str,
        data: &Value,
        transport: &mut T,
        now: Duration,
        jitter: f64,
    ) -> Result<String, NoRoute> {
        self.open_due(transport, now, jitter);
        self.open_now(transport, now, jitter);
        self.transmit(method, data, now)
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

    /// Dials the peer on a use, when it has never been dialed before.
    fn open_now<T: Dialer>(&mut self, transport: &mut T, now: Duration, jitter: f64) {
        if self.state != PeerState::Idle {
            return;
        }
        self.dial(transport, now, jitter);
    }
    /// Dials the peer in the background, when an interval it earned has ended.
    fn open_due<T: Dialer>(&mut self, transport: &mut T, now: Duration, jitter: f64) {
        if !self.is_due(now) {
            return;
        }
        self.dial(transport, now, jitter);
    }

    /// Whether a background dial is owed: an interval that ended just now.
    fn is_due(&self, now: Duration) -> bool {
        let is_waiting = self.is_waiting();
        is_waiting && self.next_dial_in(now).is_zero()
    }

    /// Attempts one connection, keeping it or banking the failure.
    fn dial<T: Dialer>(&mut self, transport: &mut T, now: Duration, jitter: f64) {
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

    /// Puts a peer that answered back where a healthy peer starts.
    const fn reset_failures(&mut self) {
        self.failures = 0;
        self.capped_intervals = 0;
        self.retry_at = None;
        self.retry_delay = Duration::ZERO;
        self.last_failure = None;
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

    /// Whether a long outage has throttled dialing down to a probe.
    const fn is_breaker_armed(&self) -> bool {
        self.capped_intervals > self.policy.trip_after
    }

    /// Whether the peer is waiting out an interval rather than needing a dial.
    const fn is_waiting(&self) -> bool {
        matches!(self.state, PeerState::BackingOff | PeerState::CoolingDown)
    }

    /// Reports whether this failure earns a notice, and records that it did.
    ///
    /// The opening burst is never throttled, because the first failures are
    /// what a log is for; past that, one notice per interval is enough to see
    /// an outage without writing a line per attempt for hours.
    fn note_is_due(&mut self, now: Duration) -> bool {
        if self.failures <= NOTICE_BURST {
            self.last_notice = Some(now);
            return true;
        }
        let last = self.last_notice.unwrap_or(Duration::ZERO);
        if now.saturating_sub(last) < self.policy.notice_every {
            return false;
        }
        self.last_notice = Some(now);
        true
    }

    /// Writes one call out, or refuses it with the peer's own state.
    fn transmit(&mut self, method: &str, data: &Value, now: Duration) -> Result<String, NoRoute> {
        if !self.is_live() {
            return Err(self.no_route(now));
        }
        let id = format!("cms-svc-{}", self.next_id);
        self.next_id = self.next_id.saturating_add(1);
        let envelope = json!({ ID_KEY: id, METHOD_KEY: method, DATA_KEY: data });
        match self
            .session
            .as_mut()
            .map(|session| session.write(&envelope))
        {
            Some(Ok(())) => Ok(id),
            Some(Err(reason)) => {
                self.lost(reason, now);
                Err(self.no_route(now))
            }
            None => Err(self.no_route(now)),
        }
    }

    /// The refusal a peer in this state gives a caller.
    fn no_route(&self, now: Duration) -> NoRoute {
        if self.is_absent() {
            return NoRoute::Absent;
        }
        NoRoute::NotConnected {
            state: self.state,
            due_in: self.next_dial_in(now),
        }
    }
}
