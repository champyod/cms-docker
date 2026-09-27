//! Reconnect notices: what one says, and when the burst of them stops.

use std::time::Duration;

use cms_svc::{DialError, ReconnectNotice};

use crate::{first_use, policy, Scripted, BASE};

#[test]
fn a_notice_names_the_failures_the_wait_and_the_reason() {
    let (mut peer, recorder) = crate::connector(policy());
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
    let (mut peer, recorder) = crate::connector(policy());
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
