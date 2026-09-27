//! The numbers every interval and every notice is built from.
//!
//! The interval a failed dial earns, the ceiling it stops at, the cap the
//! breaker probes under and the gap between two notices are one policy's worth
//! of numbers, so they are declared together with the arithmetic that reads
//! them. That arithmetic is written out rather than taken from a crate because
//! the exact shape of it is the behaviour: doubling from a half-second base,
//! folded jitter under the same ceiling, and a `NaN` refused rather than
//! rounded, all of which the Python loop a peer is dialled against does by hand.

use std::time::Duration;

use super::state::DialError;
use super::Connector;

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

impl Connector {
    /// Reports whether this failure earns a notice, and records that it did.
    ///
    /// The opening burst is never throttled, because the first failures are
    /// what a log is for; past that, one notice per interval is enough to see
    /// an outage without writing a line per attempt for hours.
    pub(super) fn note_is_due(&mut self, now: Duration) -> bool {
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
}
