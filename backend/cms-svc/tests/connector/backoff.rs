//! The backoff ladder: how long each refusal costs, how the ceiling is reached,
//! and how the breaker arms on a sustained outage and lets go on a live peer.

use std::time::Duration;

use cms_svc::{BackoffPolicy, DialError, PeerState};

use crate::{
    fail_out, first_use, is_wait, policy, unbreakable, use_it, Attempt, Scripted, BASE, CAP,
    COOLDOWN,
};

#[test]
fn every_refusal_waits_twice_as_long_as_the_one_before() {
    let (mut peer, recorder) = crate::connector(unbreakable());
    let mut transport = Scripted::refusing(recorder);
    first_use(&mut peer, &mut transport);
    let mut now = peer.next_dial_in(Duration::ZERO);
    let mut waits = vec![now];

    for _ in 0..4 {
        now += peer.next_dial_in(now);
        let _ = peer.poll(&mut transport, now, 0.0);
        waits.push(peer.next_dial_in(now));
    }

    for (got, want) in waits.iter().copied().zip([BASE, BASE * 2, CAP, CAP, CAP]) {
        assert!(is_wait(got, want), "waited {got:?}, wanted {want:?}");
    }
}

#[test]
fn jitter_only_ever_adds_within_the_ceiling() {
    let jittered = policy();

    assert_eq!(jittered.interval(1, 0.0), BASE);
    assert!(is_wait(
        jittered.interval(1, 0.5),
        Duration::from_millis(150)
    ));
    assert!(is_wait(
        jittered.interval(2, 1.0),
        Duration::from_millis(300)
    ));
    assert_eq!(jittered.interval(3, 0.5), CAP);
    assert_eq!(jittered.interval(3, 0.75), CAP);
    assert_eq!(jittered.interval(u32::MAX, 1.0), CAP);
}

#[test]
fn a_sampled_jitter_is_a_unit_fraction() {
    let jittered = policy();

    let drawn = BackoffPolicy::sample_jitter();

    assert!(
        (0.0..=1.0).contains(&drawn),
        "a draw is a unit fraction, got {drawn}"
    );
    let jittered = jittered.interval(1, drawn);
    assert!(
        (BASE..=CAP).contains(&jittered),
        "a jittered interval stays under the ceiling, got {jittered:?}"
    );
}

#[test]
fn a_jitter_outside_the_unit_interval_is_refused() {
    let jittered = policy();

    assert_eq!(jittered.interval(1, 1.5), BASE, "above the unit interval");
    assert_eq!(jittered.interval(1, -0.5), BASE, "below the unit interval");
    assert_eq!(
        jittered.interval(1, f64::NAN),
        BASE,
        "not a fraction at all"
    );
}

#[test]
fn a_sustained_outage_throttles_dialing_to_the_cooldown() {
    let (mut peer, recorder) = crate::connector(policy());
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
    let (mut peer, recorder) = crate::connector(policy());
    let mut transport = Scripted::answering_after(5, recorder);
    let armed_at = fail_out(&mut peer, &mut transport, 4);
    assert_eq!(peer.state(), PeerState::CoolingDown);

    peer.poll(&mut transport, armed_at + COOLDOWN, 0.0);

    assert_eq!(peer.state(), PeerState::Live);
    assert_eq!(peer.next_dial_in(armed_at + COOLDOWN), Duration::ZERO);
}

#[test]
fn a_connected_peer_earns_no_backoff_for_the_outage_after_it() {
    let (mut peer, recorder) = crate::connector(policy());
    let mut transport = Scripted::new(vec![Attempt::Connect, Attempt::Refuse], recorder);
    use_it(&mut peer, &mut transport, Duration::ZERO).expect("the peer connects");
    peer.lost(DialError::Lost, Duration::ZERO);
    assert_eq!(peer.next_dial_in(Duration::ZERO), Duration::ZERO);

    peer.poll(&mut transport, Duration::ZERO, 0.0);

    assert_eq!(peer.state(), PeerState::BackingOff);
    assert_eq!(peer.next_dial_in(Duration::ZERO), BASE);
}

#[test]
fn polling_a_backoff_often_never_dials_early() {
    let (mut peer, recorder) = crate::connector(policy());
    let mut transport = Scripted::refusing(recorder);
    first_use(&mut peer, &mut transport);

    for _ in 0..20 {
        peer.poll(&mut transport, BASE / 2, 0.0);
    }

    assert_eq!(transport.dials, 1);
    assert_eq!(peer.state(), PeerState::BackingOff);
}
