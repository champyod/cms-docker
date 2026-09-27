//! Send and poll routing: when a call dials, what a refusal reports, and how a
//! gate decision or a raw frame becomes a written answer.

use std::time::Duration;

use cms_proto::{error as refusal, ok, Decision, DropReason};
use cms_svc::{of_dispatch, of_frame, BackoffPolicy, NoRoute, PeerState, Send};
use serde_json::json;

use crate::{first_use, policy, use_it, Scripted, BASE};

#[test]
fn a_peer_is_not_dialled_until_it_is_used() {
    let (mut peer, recorder) = crate::connector(policy());
    let mut transport = Scripted::connecting(recorder);

    for _ in 0..10 {
        peer.poll(&mut transport, Duration::ZERO, 0.0);
    }

    assert_eq!(peer.state(), PeerState::Idle);
    assert_eq!(transport.dials, 0);
}

#[test]
fn a_first_use_connects_without_waiting_for_a_poll() {
    let (mut peer, recorder) = crate::connector(policy());
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
fn a_peer_that_is_absent_is_never_dialled() {
    let (mut peer, recorder) = crate::connector(BackoffPolicy::optional());
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
    let (mut peer, recorder) = crate::connector(policy());
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
