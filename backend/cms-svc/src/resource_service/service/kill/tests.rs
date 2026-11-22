//! `kill_service`'s two halves: the string it decodes, and the call it writes.

use std::cell::RefCell;
use std::rc::Rc;
use std::time::Duration;

use serde_json::Value;

use super::{ConnectorQuit, PeerQuit, QuitReceipt, QUIT_REASON, QUIT_TIMEOUT};
use crate::connector::{DialError, Dialer, NoRoute, PeerSession};
use crate::resource_service::fixture::{service, FixtureReader};
use crate::resource_service::{CoordError, ResourceError, ServiceCoord};

/// A peer that records what it was asked instead of connecting.
#[derive(Default)]
struct RecordingPeerQuit {
    calls: Vec<(ServiceCoord, String, Duration)>,
    refusal: Option<NoRoute>,
}

impl PeerQuit for RecordingPeerQuit {
    fn quit(
        &mut self,
        coord: &ServiceCoord,
        reason: &str,
        timeout: Duration,
    ) -> Result<QuitReceipt, NoRoute> {
        self.calls.push((coord.clone(), reason.to_owned(), timeout));
        match self.refusal {
            Some(reason) => Err(reason),
            None => Ok(QuitReceipt {
                call_id: "cms-svc-0".to_owned(),
            }),
        }
    }
}

/// A dialer that answers with a session which keeps every envelope.
struct ScriptedDialer {
    sent: Rc<RefCell<Vec<Value>>>,
}

impl Dialer for ScriptedDialer {
    fn dial(&mut self) -> Result<Box<dyn PeerSession>, DialError> {
        Ok(Box::new(RecordingSession {
            sent: Rc::clone(&self.sent),
        }))
    }
}

struct RecordingSession {
    sent: Rc<RefCell<Vec<Value>>>,
}

impl PeerSession for RecordingSession {
    fn write(&mut self, envelope: &Value) -> Result<(), DialError> {
        self.sent.borrow_mut().push(envelope.clone());
        Ok(())
    }
}

/// A dialer for a peer that is not there.
struct DeadDialer;

impl Dialer for DeadDialer {
    fn dial(&mut self) -> Result<Box<dyn PeerSession>, DialError> {
        Err(DialError::Unreachable)
    }
}

#[test]
fn a_kill_names_the_coordinate_the_reason_and_the_wait() {
    let reader = FixtureReader::with(Vec::new());
    let service = service(&reader, &[("Worker", 0)], Some(7), true);
    let mut peer = RecordingPeerQuit::default();

    let receipt = service
        .kill_service("Worker,0", &mut peer)
        .expect("a coordinate this service can parse");

    assert_eq!(receipt.call_id, "cms-svc-0");
    assert_eq!(
        peer.calls,
        vec![(
            ServiceCoord::new("Worker", 0),
            QUIT_REASON.to_owned(),
            QUIT_TIMEOUT
        )]
    );
    assert_eq!(QUIT_REASON, "Asked by ResourceService");
    assert_eq!(QUIT_TIMEOUT, Duration::from_secs(5));
}

#[test]
fn an_undecodable_name_is_refused_before_the_peer_hears_of_it() {
    let reader = FixtureReader::with(Vec::new());
    let service = service(&reader, &[("Worker", 0)], Some(7), true);
    let mut peer = RecordingPeerQuit::default();

    let missing_comma = service
        .kill_service("Worker", &mut peer)
        .expect_err("a name with no shard is not a coordinate");
    assert!(
        matches!(
            missing_comma,
            ResourceError::Coord(CoordError::MissingComma)
        ),
        "{missing_comma}"
    );

    let not_a_number = service
        .kill_service("Worker,one", &mut peer)
        .expect_err("a shard that is not a number is not a coordinate");
    assert!(
        matches!(
            not_a_number,
            ResourceError::Coord(CoordError::NotANumber(_))
        ),
        "{not_a_number}"
    );
    assert!(peer.calls.is_empty());
}

#[test]
fn the_quit_call_is_written_through_the_connector() {
    let sent = Rc::new(RefCell::new(Vec::new()));
    let mut dialer = ScriptedDialer {
        sent: Rc::clone(&sent),
    };
    let mut peer = ConnectorQuit::new(&mut dialer, Duration::ZERO);

    let receipt = peer
        .quit(&ServiceCoord::new("Worker", 0), QUIT_REASON, QUIT_TIMEOUT)
        .expect("a dialer that answers accepts the call");

    assert_eq!(receipt.call_id, "cms-svc-0");
    let envelopes = sent.borrow();
    assert_eq!(envelopes.len(), 1);
    assert_eq!(envelopes[0]["__method"], "quit");
    assert_eq!(envelopes[0]["__data"]["reason"], QUIT_REASON);
    assert_eq!(envelopes[0]["__id"], "cms-svc-0");
}

#[test]
fn a_peer_that_does_not_answer_is_reported_not_swallowed() {
    let reader = FixtureReader::with(Vec::new());
    let service = service(&reader, &[("Worker", 0)], Some(7), true);
    let mut dialer = DeadDialer;
    let mut peer = ConnectorQuit::new(&mut dialer, Duration::ZERO);

    let error = service
        .kill_service("Worker,0", &mut peer)
        .expect_err("a peer that refused the dial has no route");

    assert!(
        matches!(error, ResourceError::Quit { ref reason, .. } if !matches!(reason, NoRoute::Absent)),
        "{error}"
    );
    assert_eq!(
        error.to_string(),
        "Worker,0 did not accept quit: no connection to the peer, next dial in 5s"
    );
}
