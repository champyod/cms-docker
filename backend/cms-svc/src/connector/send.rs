//! What one message costs a connection, and the refusal when there is no route.
//!
//! Every envelope leaves through here, so the wire keys are written once, and a
//! failed write is a connection that is gone rather than a call that was lost:
//! the two refusals a caller gets are absent, and known but not live.

use std::time::Duration;

use cms_proto::{error as refusal_envelope, Decision, Response};
use serde_json::{json, Value};

use super::state::{Dialer, PeerState};
use super::Connector;

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

/// What the connection owes the peer about one message.
#[derive(Debug, Clone, PartialEq, Eq)]
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

impl Connector {
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

    /// Dials the peer in the background, when an interval it earned has ended.
    pub(super) fn open_due<T: Dialer>(&mut self, transport: &mut T, now: Duration, jitter: f64) {
        if !self.is_due(now) {
            return;
        }
        self.dial(transport, now, jitter);
    }

    /// Dials the peer on a use, when it has never been dialed before.
    fn open_now<T: Dialer>(&mut self, transport: &mut T, now: Duration, jitter: f64) {
        if self.state != PeerState::Idle {
            return;
        }
        self.dial(transport, now, jitter);
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
