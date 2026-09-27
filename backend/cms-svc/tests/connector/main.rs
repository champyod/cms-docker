//! A peer, its clock and its transport, all supplied by the test.
//!
//! Nothing here opens a socket. The transport is a script of what the peer does
//! with each dial, and the clock is a [`Duration`] the test advances by hand, so
//! a backoff sequence, a breaker and a recovery are decided rather than waited
//! for. Every assertion is a position on that fake clock, which is why these
//! tests are deterministic: no sleeps, no wall time, no retries.
//!
//! The fake peer and its clock live here; the tests that drive it are split by
//! concern into [`backoff`], [`notices`] and [`send`].

mod backoff;
mod notices;
mod send;

use std::cell::RefCell;
use std::rc::Rc;
use std::time::Duration;

use cms_svc::{BackoffPolicy, Connector, DialError, Dialer, NoRoute, PeerSession};
use serde_json::{json, Value};

/// The base every policy here starts from, small enough to count in.
pub(crate) const BASE: Duration = Duration::from_millis(100);

/// Ceiling every policy here uses, so the cap is reached on the third try.
pub(crate) const CAP: Duration = Duration::from_millis(400);

/// The interval the breaker probes at, four times the cap.
pub(crate) const COOLDOWN: Duration = Duration::from_millis(1_600);

/// Consecutive capped waits before the breaker arms.
pub(crate) const TRIP_AFTER: u32 = 2;

/// Shortest gap between two notices past the opening burst.
pub(crate) const NOTICE: Duration = Duration::from_millis(1_000);

/// How far a wait may sit from the exact multiple, in the ladder's own units.
///
/// The doubling is computed in binary floating point, so a wait lands a few
/// nanoseconds off a multiple of the base rather than exactly on it, and the
/// ceiling is still hit exactly because an overshoot is clamped.
const ROUNDING: Duration = Duration::from_micros(1);

/// Whether a wait is the wanted one to within [`ROUNDING`].
pub(crate) fn is_wait(got: Duration, want: Duration) -> bool {
    got.abs_diff(want) <= ROUNDING
}

/// What the peer does with each dial, in order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Attempt {
    /// The peer answers.
    Connect,

    /// Nothing is listening.
    Refuse,
}

/// One connection that records what was written to it.
#[derive(Default)]
pub(crate) struct Recorder {
    written: RefCell<Vec<Value>>,
}

impl Recorder {
    pub(crate) fn envelopes(&self) -> Vec<Value> {
        self.written.borrow().clone()
    }
}

/// The one connection the script hands out, sharing the recorder.
struct Session(Rc<Recorder>);

impl PeerSession for Session {
    fn write(&mut self, envelope: &Value) -> Result<(), DialError> {
        self.0.written.borrow_mut().push(envelope.clone());
        Ok(())
    }
}

/// A transport that answers each dial from its script, and counts them.
pub(crate) struct Scripted {
    attempts: Vec<Attempt>,
    recorder: Rc<Recorder>,
    pub(crate) dials: usize,
}

impl Scripted {
    pub(crate) const fn new(attempts: Vec<Attempt>, recorder: Rc<Recorder>) -> Self {
        Self {
            attempts,
            recorder,
            dials: 0,
        }
    }

    pub(crate) fn connecting(recorder: Rc<Recorder>) -> Self {
        Self::new(vec![Attempt::Connect], recorder)
    }

    pub(crate) fn refusing(recorder: Rc<Recorder>) -> Self {
        Self::new(vec![Attempt::Refuse], recorder)
    }

    /// Refuses the first `refusals` dials, then answers.
    pub(crate) fn answering_after(refusals: usize, recorder: Rc<Recorder>) -> Self {
        let mut attempts = vec![Attempt::Refuse; refusals];
        attempts.push(Attempt::Connect);
        Self::new(attempts, recorder)
    }
}

impl Dialer for Scripted {
    fn dial(&mut self) -> Result<Box<dyn PeerSession>, DialError> {
        let attempt = self.attempts.get(self.dials).copied();
        self.dials += 1;
        if attempt == Some(Attempt::Connect) {
            return Ok(Box::new(Session(self.recorder.clone())));
        }
        Err(DialError::Unreachable)
    }
}

/// A policy whose intervals are multiples of [`BASE`], so a delay is a count.
pub(crate) const fn policy() -> BackoffPolicy {
    BackoffPolicy {
        base: BASE,
        max: CAP,
        trip_after: TRIP_AFTER,
        cooldown: COOLDOWN,
        notice_every: NOTICE,
        is_optional: false,
    }
}

/// The same policy with the breaker disarmed, for the sequence itself.
pub(crate) const fn unbreakable() -> BackoffPolicy {
    BackoffPolicy {
        trip_after: u32::MAX,
        ..policy()
    }
}

/// A connector over the given policy, and the recorder its session writes into.
pub(crate) fn connector(policy: BackoffPolicy) -> (Connector, Rc<Recorder>) {
    let recorder = Rc::new(Recorder::default());
    (Connector::new("worker-0", policy), recorder)
}

/// Sends one call, at the given instant on the scripted transport.
pub(crate) fn use_it(
    peer: &mut Connector,
    transport: &mut Scripted,
    now: Duration,
) -> Result<String, NoRoute> {
    peer.send("get_status", &json!({}), transport, now, 0.0)
}

/// Uses the peer once, so the first dial happens and is refused.
pub(crate) fn first_use(peer: &mut Connector, transport: &mut Scripted) {
    use_it(peer, transport, Duration::ZERO).expect_err("the script refuses the first dial");
}

/// Polls the peer the given number of times, returning the clock it reached.
pub(crate) fn fail_out(peer: &mut Connector, transport: &mut Scripted, polls: u32) -> Duration {
    first_use(peer, transport);
    let mut clock = peer.next_dial_in(Duration::ZERO);
    for _ in 0..polls {
        clock += peer.next_dial_in(clock);
        let _ = peer.poll(transport, clock, 0.0);
    }
    clock
}
