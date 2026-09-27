//! A peer, its clock and its transport, all supplied by the test.
//!
//! Nothing here opens a socket. The transport is a script of what the peer does
//! with each dial, and the clock is a [`Duration`] the test advances by hand, so
//! a backoff sequence, a breaker and a recovery are decided rather than waited
//! for. Every assertion is a position on that fake clock, which is why these
//! tests are deterministic: no sleeps, no wall time, no retries.

use std::cell::RefCell;
use std::rc::Rc;
use std::time::Duration;

use cms_proto::{error as refusal, ok, Decision, DropReason};
use cms_svc::{
    of_dispatch, of_frame, BackoffPolicy, Connector, DialError, Dialer, NoRoute, PeerSession,
    PeerState, ReconnectNotice, Send,
};
use serde_json::{json, Value};

/// The base every policy here starts from, small enough to count in.
const BASE: Duration = Duration::from_millis(100);

/// Ceiling every policy here uses, so the cap is reached on the third try.
const CAP: Duration = Duration::from_millis(400);

/// The interval the breaker probes at, four times the cap.
const COOLDOWN: Duration = Duration::from_millis(1_600);

/// Consecutive capped waits before the breaker arms.
const TRIP_AFTER: u32 = 2;

/// Shortest gap between two notices past the opening burst.
const NOTICE: Duration = Duration::from_millis(1_000);

/// What the peer does with each dial, in order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Attempt {
    /// The peer answers.
    Connect,

    /// Nothing is listening.
    Refuse,
}

/// One connection that records what was written to it.
#[derive(Default)]
struct Recorder {
    written: RefCell<Vec<Value>>,
}

impl Recorder {
    fn envelopes(&self) -> Vec<Value> {
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
struct Scripted {
    attempts: Vec<Attempt>,
    recorder: Rc<Recorder>,
    dials: usize,
}

impl Scripted {
    const fn new(attempts: Vec<Attempt>, recorder: Rc<Recorder>) -> Self {
        Self {
            attempts,
            recorder,
            dials: 0,
        }
    }

    fn connecting(recorder: Rc<Recorder>) -> Self {
        Self::new(vec![Attempt::Connect], recorder)
    }

    fn refusing(recorder: Rc<Recorder>) -> Self {
        Self::new(vec![Attempt::Refuse], recorder)
    }

    /// Refuses the first `refusals` dials, then answers.
    fn answering_after(refusals: usize, recorder: Rc<Recorder>) -> Self {
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
const fn policy() -> BackoffPolicy {
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
const fn unbreakable() -> BackoffPolicy {
    BackoffPolicy {
        trip_after: u32::MAX,
        ..policy()
    }
}

/// A connector over the given policy, and the recorder its session writes into.
fn connector(policy: BackoffPolicy) -> (Connector, Rc<Recorder>) {
    let recorder = Rc::new(Recorder::default());
    (Connector::new("worker-0", policy), recorder)
}

/// Sends one call, at the given instant on the scripted transport.
fn use_it(
    peer: &mut Connector,
    transport: &mut Scripted,
    now: Duration,
) -> Result<String, NoRoute> {
    peer.send("get_status", &json!({}), transport, now, 0.0)
}

/// Uses the peer once, so the first dial happens and is refused.
fn first_use(peer: &mut Connector, transport: &mut Scripted) {
    use_it(peer, transport, Duration::ZERO).expect_err("the script refuses the first dial");
}

/// Polls the peer the given number of times, returning the clock it reached.
fn fail_out(peer: &mut Connector, transport: &mut Scripted, polls: u32) -> Duration {
    first_use(peer, transport);
    let mut clock = peer.next_dial_in(Duration::ZERO);
    for _ in 0..polls {
        clock += peer.next_dial_in(clock);
        let _ = peer.poll(transport, clock, 0.0);
    }
    clock
}

#[test]
fn a_peer_is_not_dialled_until_it_is_used() {
    let (mut peer, recorder) = connector(policy());
    let mut transport = Scripted::connecting(recorder);

    for _ in 0..10 {
        peer.poll(&mut transport, Duration::ZERO, 0.0);
    }

    assert_eq!(peer.state(), PeerState::Idle);
    assert_eq!(transport.dials, 0);
}

#[test]
fn a_first_use_connects_without_waiting_for_a_poll() {
    let (mut peer, recorder) = connector(policy());
    let mut transport = Scripted::connecting(recorder.clone());

    let id =
        use_it(&mut peer, &mut transport, Duration::ZERO).expect("the first use dials on the spot");

    assert_eq!(peer.state(), PeerState::Live);
    assert_eq!(transport.dials, 1);
    assert_eq!(
        recorder.envelopes()[0],
        json!({"__id": id, "__method": "get_status", "__data": {}})
    );
}

#[test]
fn every_refusal_waits_twice_as_long_as_the_one_before() {
    let (mut peer, recorder) = connector(unbreakable());
    let mut transport = Scripted::refusing(recorder);
    first_use(&mut peer, &mut transport);
    let mut now = peer.next_dial_in(Duration::ZERO);
    let mut waits = vec![now];

    for _ in 0..4 {
        now += peer.next_dial_in(now);
        let _ = peer.poll(&mut transport, now, 0.0);
        waits.push(peer.next_dial_in(now));
    }

    assert_eq!(waits, vec![BASE, BASE * 2, CAP, CAP, CAP]);
}

#[test]
fn jitter_only_ever_adds_within_the_ceiling() {
    let jittered = policy();

    assert_eq!(jittered.interval(1, 0.0), BASE);
    assert_eq!(jittered.interval(1, 0.5), Duration::from_millis(150));
    assert_eq!(jittered.interval(2, 1.0), Duration::from_millis(300));
    assert_eq!(jittered.interval(3, 0.5), CAP);
    assert_eq!(jittered.interval(3, 0.75), CAP);
    assert_eq!(jittered.interval(u32::MAX, 1.0), CAP);
}

#[test]
fn a_sustained_outage_throttles_dialing_to_the_cooldown() {
    let (mut peer, recorder) = connector(policy());
    let mut transport = Scripted::refusing(recorder);
    first_use(&mut peer, &mut transport);
    let mut now = peer.next_dial_in(Duration::ZERO);
    let mut states = Vec::new();

    for _ in 0..4 {
        now += peer.next_dial_in(now);
        peer.poll(&mut transport, now, 0.0);
        states.push(peer.state());
    }

    assert_eq!(
        states,
        vec![
            PeerState::BackingOff,
            PeerState::BackingOff,
            PeerState::BackingOff,
            PeerState::CoolingDown,
        ]
    );
    assert_eq!(peer.next_dial_in(now), COOLDOWN);
}

#[test]
fn a_peer_that_answers_comes_back_from_the_breaker() {
    let (mut peer, recorder) = connector(policy());
    let mut transport = Scripted::answering_after(5, recorder);
    let armed_at = fail_out(&mut peer, &mut transport, 4);
    assert_eq!(peer.state(), PeerState::CoolingDown);

    peer.poll(&mut transport, armed_at + COOLDOWN, 0.0);

    assert_eq!(peer.state(), PeerState::Live);
    assert_eq!(peer.next_dial_in(armed_at + COOLDOWN), Duration::ZERO);
}

#[test]
fn a_connected_peer_earns_no_backoff_for_the_outage_after_it() {
    let (mut peer, recorder) = connector(policy());
    let mut transport = Scripted::new(vec![Attempt::Connect, Attempt::Refuse], recorder);
    use_it(&mut peer, &mut transport, Duration::ZERO).expect("the peer connects");
    peer.lost(DialError::Lost, Duration::ZERO);
    assert_eq!(peer.next_dial_in(Duration::ZERO), Duration::ZERO);

    peer.poll(&mut transport, Duration::ZERO, 0.0);

    assert_eq!(peer.state(), PeerState::BackingOff);
    assert_eq!(peer.next_dial_in(Duration::ZERO), BASE);
}

#[test]
fn a_notice_names_the_failures_the_wait_and_the_reason() {
    let (mut peer, recorder) = connector(policy());
    let mut transport = Scripted::refusing(recorder);
    first_use(&mut peer, &mut transport);

    let notice = peer.poll(&mut transport, Duration::ZERO, 0.0);

    assert_eq!(
        notice,
        Some(ReconnectNotice {
            failures: 1,
            delay: BASE,
            reason: DialError::Unreachable,
        })
    );
}

#[test]
fn notices_stop_once_the_opening_burst_is_over() {
    let (mut peer, recorder) = connector(policy());
    let mut transport = Scripted::refusing(recorder);
    first_use(&mut peer, &mut transport);
    let mut now = Duration::ZERO;
    let mut notices = Vec::new();

    for _ in 0..5 {
        notices.push(peer.poll(&mut transport, now, 0.0).is_some());
        now += peer.next_dial_in(now);
    }

    assert_eq!(notices, vec![true, true, true, false, false]);
}

#[test]
fn polling_a_backoff_often_never_dials_early() {
    let (mut peer, recorder) = connector(policy());
    let mut transport = Scripted::refusing(recorder);
    first_use(&mut peer, &mut transport);

    for _ in 0..20 {
        peer.poll(&mut transport, BASE / 2, 0.0);
    }

    assert_eq!(transport.dials, 1);
    assert_eq!(peer.state(), PeerState::BackingOff);
}

#[test]
fn a_peer_that_is_absent_is_never_dialled() {
    let (mut peer, recorder) = connector(BackoffPolicy::optional());
    let mut transport = Scripted::connecting(recorder);

    let refused = peer.send(
        "get_status",
        &json!({}),
        &mut transport,
        Duration::ZERO,
        0.0,
    );

    assert_eq!(refused, Err(NoRoute::Absent));
    assert_eq!(peer.state(), PeerState::NeverDialed);
    assert_eq!(transport.dials, 0);
    assert!(peer.is_absent());
}

#[test]
fn a_refused_call_reports_the_state_and_the_wait() {
    let (mut peer, recorder) = connector(policy());
    let mut transport = Scripted::refusing(recorder);
    first_use(&mut peer, &mut transport);

    let refused = use_it(&mut peer, &mut transport, BASE / 10);

    assert_eq!(
        refused,
        Err(NoRoute::NotConnected {
            state: PeerState::BackingOff,
            due_in: BASE.saturating_sub(BASE / 10),
        })
    );
    assert_eq!(transport.dials, 1, "asking twice does not dial twice");
}

#[test]
fn a_drop_is_a_drop_and_a_refusal_is_written() {
    let dropped = of_dispatch(&Decision::Dropped(DropReason::IdNotAString));
    let refused = of_dispatch(&Decision::Answered(refusal("7", "no.")));
    let answered = of_dispatch(&Decision::Answered(ok("7", json!(1))));

    assert_eq!(dropped, Send::Dropped);
    let (Send::Answer(refusal), Send::Answer(answer)) = (refused, answered) else {
        panic!("a decision the gate answered is written, not dropped");
    };
    assert!(refusal.error.is_some());
    assert!(answer.error.is_none());
}

#[test]
fn a_frame_with_an_id_is_refused_and_one_without_is_dropped() {
    let refused = of_frame(&json!({"__id": "7", "__method": "go", "__data": 3}));
    let dropped = of_frame(&json!({"__method": "go", "__data": 3}));

    assert_eq!(dropped, Send::Dropped);
    let Send::Answer(answer) = refused else {
        panic!("a frame that carries an id is refused, not dropped");
    };
    assert_eq!(answer.id, "7");
    assert_eq!(
        answer.error,
        Some(json!("__data is not an object.")),
        "a refusal is answered, so it carries its reason"
    );
}
