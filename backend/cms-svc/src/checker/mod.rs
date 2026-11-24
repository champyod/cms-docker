//! The liveness round Python's `Checker.check` performs against every configured service.
//!
//! Each peer keeps one synchronous client between rounds. A round visits every row,
//! including peers on other hosts, and a refusal is recorded for that peer rather than
//! ending the round. The caller supplies the send clock; monotonic call time advances
//! it to the reply clock, so the ten-second late threshold is testable without sleeping.

mod error;
mod report;

use std::time::Instant;

use serde_json::Value;

use crate::resource_service::all_services;
use crate::{Client, LocalService, ServiceCoord};

pub use error::CheckerError;
pub use report::{CheckReport, PeerCheck};

/// A reply older than this many seconds is late, as `Checker.py:82` spells it.
const LATE_AFTER_SECONDS: f64 = 10.0;

/// One configured peer and the connection retained for its next round.
struct Peer {
    service: LocalService,
    client: Option<Client>,
}

/// Probes every configured service and keeps each working connection for the next round.
pub struct Checker {
    peers: Vec<Peer>,
    secret: Option<String>,
}

impl Checker {
    /// Parses every row of `table`, refusing the whole table when one row is unusable.
    ///
    /// # Errors
    ///
    /// Returns [`CheckerError::Table`] when a row is malformed or its host cannot resolve.
    pub fn new(table: &str) -> Result<Self, CheckerError> {
        let peers = all_services(table)?
            .into_iter()
            .map(|service| Peer {
                service,
                client: None,
            })
            .collect();
        Ok(Self {
            peers,
            secret: None,
        })
    }

    /// Sets the optional RPC secret every outbound call presents.
    #[must_use]
    pub fn with_secret(mut self, secret: Option<String>) -> Self {
        self.secret = secret;
        self
    }

    /// Dials missing clients, echoes one timestamp to every peer, and records each outcome.
    ///
    /// `now_seconds` is the clock at send time; the elapsed call advances it to the
    /// reply clock, so a test can move it forward to make an old answer late without waiting.
    pub fn check_once(&mut self, now_seconds: f64) -> CheckReport {
        let mut report = CheckReport::default();
        for peer in &mut self.peers {
            let coord = peer.service.coord.clone();
            let result = Self::check_peer(peer, self.secret.as_deref(), now_seconds);
            match result {
                Ok((latency, age, late)) => {
                    if late {
                        eprintln!("Got late reply ({age:.3} s) from {coord}.");
                    }
                    report.push(PeerCheck {
                        coord,
                        latency: Some(latency),
                        late,
                        error: None,
                    });
                }
                Err(error) => {
                    eprintln!("Service {coord} check failed: {error}");
                    report.push(PeerCheck {
                        coord,
                        latency: None,
                        late: false,
                        error: Some(error),
                    });
                }
            }
        }
        report
    }

    /// Checks one peer, dropping its client whenever the RPC connection itself failed.
    fn check_peer(
        peer: &mut Peer,
        secret: Option<&str>,
        now_seconds: f64,
    ) -> Result<(f64, f64, bool), CheckerError> {
        let coord = peer.service.coord.clone();
        let message = format!("{coord} {now_seconds:.3}");
        let started = Instant::now();
        let answer = match peer.client.as_mut() {
            Some(client) => client.echo(&message),
            None => {
                let mut client = Client::connect(peer.service.address, secret.map(str::to_owned))
                    .map_err(|source| CheckerError::Rpc {
                    coord: coord.clone(),
                    source,
                })?;
                let answer = client.echo(&message);
                peer.client = Some(client);
                answer
            }
        };
        let latency = started.elapsed().as_secs_f64();
        let answer = match answer {
            Ok(answer) => answer,
            Err(source) => {
                peer.client = None;
                return Err(CheckerError::Rpc { coord, source });
            }
        };
        let sent_at = parse_reply(&answer, &coord)?;
        let age = now_seconds + latency - sent_at;
        Ok((latency, age, age > LATE_AFTER_SECONDS))
    }
}

/// Reads `Coord timestamp` and refuses an answer that names another peer or time.
fn parse_reply(answer: &Value, expected: &ServiceCoord) -> Result<f64, CheckerError> {
    let invalid = |reason| CheckerError::InvalidReply {
        coord: expected.clone(),
        reason,
    };
    let text = answer
        .as_str()
        .ok_or_else(|| invalid("it is not a string"))?;
    let fields: Vec<&str> = text.split_whitespace().collect();
    let [peer, timestamp] = fields.as_slice() else {
        return Err(invalid("it is not Coord timestamp"));
    };
    let peer = ServiceCoord::parse(peer).map_err(|_| invalid("its coordinate is unreadable"))?;
    if &peer != expected {
        return Err(invalid("it names another peer"));
    }
    let timestamp = timestamp
        .parse::<f64>()
        .map_err(|_| invalid("its timestamp is not a number"))?;
    if !timestamp.is_finite() {
        return Err(invalid("its timestamp is not finite"));
    }
    Ok(timestamp)
}
