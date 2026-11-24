//! The running checker: its base RPC methods, immediate round, and stop path.

use std::net::SocketAddr;
use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use cms_proto::{GateConfig, Method};
use cms_svc::{Host, HostError, RunOutcome, Stop};
use serde_json::{json, Value};

use crate::{connect, echo, finish, supplied, SECRET, SERVICES_VARIABLE};

/// A peer host that records the checker's first echoed string.
struct PeerHost {
    addr: SocketAddr,
    stop: Stop,
    thread: Option<JoinHandle<Result<RunOutcome, HostError>>>,
}

impl PeerHost {
    /// Starts one echo peer and returns the channel that observes its calls.
    fn start() -> (Self, Receiver<String>) {
        let (sender, receiver) = sync_channel(1);
        let methods = vec![Method {
            name: "echo",
            is_callable: true,
            handler: recording_echo,
        }];
        let config = GateConfig {
            secret: Some(SECRET),
            is_backdoor_enabled: false,
        };
        let host = Host::bind("127.0.0.1:0", methods, sender, config)
            .expect("an ephemeral peer port is bindable");
        let addr = host.local_addr().expect("the peer reports its address");
        let stop = host.stop_handle();
        let thread = Some(thread::spawn(move || host.run()));
        (Self { addr, stop, thread }, receiver)
    }

    /// The address the kernel selected for this peer.
    const fn addr(&self) -> SocketAddr {
        self.addr
    }
}

impl Drop for PeerHost {
    fn drop(&mut self) {
        self.stop.request();
        self.thread
            .take()
            .expect("the peer thread is joined once")
            .join()
            .expect("the peer thread does not panic")
            .expect("the peer stops normally");
    }
}

#[test]
fn the_base_methods_are_served_by_the_real_host() {
    let mut running = crate::spawn_with(&crate::supplied(crate::PORT_VARIABLE, Some("0")));
    let mut stream = connect(running.started());

    assert_eq!(echo(&mut stream, "héllo"), json!("héllo"));
}

#[test]
fn quit_stops_the_process_and_it_exits_zero() {
    let mut running = crate::spawn_with(&crate::supplied(crate::PORT_VARIABLE, Some("0")));
    let mut stream = connect(running.started());

    let reply = crate::call(
        &mut stream,
        "quit",
        "quit",
        json!({"reason": "asked to stop"}),
    );
    assert_eq!(reply["__data"], Value::Null);

    let (status, stderr) = finish(running);
    assert!(status.success(), "a plain quit exits zero, got {status:?}");
    assert!(
        stderr.contains("Trying to exit as asked by another service (asked to stop)."),
        "the reason must be the one it was given, got: {stderr}"
    );
}

#[test]
fn the_first_liveness_round_runs_immediately_against_the_configured_peer() {
    let (peer, observed) = PeerHost::start();
    let table = format!("Peer|0|{}|{}\n", peer.addr().ip(), peer.addr().port());
    let mut running = crate::spawn_with(&supplied(SERVICES_VARIABLE, Some(&table)));
    let _address = running.started();

    let message = observed
        .recv_timeout(Duration::from_secs(5))
        .expect("the immediate round reaches the configured peer");
    let (coord, timestamp) = message
        .split_once(' ')
        .expect("the echo carries a coordinate and timestamp");
    assert_eq!(coord, "Peer,0");
    let (whole, fraction) = timestamp
        .split_once('.')
        .expect("the timestamp has three decimal places");
    assert!(whole.parse::<u64>().is_ok(), "the seconds are a number");
    assert_eq!(
        fraction.len(),
        3,
        "the timestamp is rendered to milliseconds"
    );
}

/// Records the echoed string before returning it unchanged.
fn recording_echo(data: &Value, observed: &SyncSender<String>) -> Result<Value, String> {
    let text = data["string"]
        .as_str()
        .ok_or_else(|| "echo() missing 1 required positional argument: 'string'".to_owned())?;
    observed
        .send(text.to_owned())
        .map_err(|_| "the checker observer disconnected".to_owned())?;
    Ok(Value::String(text.to_owned()))
}
