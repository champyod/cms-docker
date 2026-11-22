//! A host that comes back when another thread asks it to, whatever its connections are doing.

use std::net::{SocketAddr, TcpStream};
use std::thread::{self, JoinHandle};

use cms_proto::GateConfig;
use cms_svc::{Host, RunOutcome, Stop};
use serde_json::json;

use crate::{answer_with_arguments, callable, connect, read_reply, send, wire, SECRET};

/// Serves one echoing method on an ephemeral port, with the handle that stops it.
fn serve() -> (SocketAddr, Stop, JoinHandle<RunOutcome>) {
    let config = GateConfig {
        secret: Some(SECRET),
        is_backdoor_enabled: false,
    };
    let host = Host::bind(
        "127.0.0.1:0",
        vec![callable("probe", answer_with_arguments)],
        config,
    )
    .expect("an ephemeral port is bindable");
    let addr = host
        .local_addr()
        .expect("a bound listener reports its address");
    let stop = host.stop_handle();
    let running = thread::spawn(move || host.run().expect("a stopped host returns no error"));
    (addr, stop, running)
}

/// Proves the host is serving, so a stop is asked of a running loop and not of one still starting.
fn probe(addr: SocketAddr) -> TcpStream {
    let mut stream = connect(addr);
    send(
        &mut stream,
        &wire(&json!({
            "__id": "probe",
            "__method": "probe",
            "__data": {"state": "serving"},
            "__secret": SECRET,
        })),
    );
    assert_eq!(
        read_reply(&mut stream)["__data"],
        json!({"state": "serving"}),
        "the host answers before it is asked to stop"
    );
    stream
}

#[test]
fn run_returns_when_another_thread_asks_it_to_stop() {
    let (addr, stop, running) = serve();
    let _stream = probe(addr);

    stop.request();

    assert_eq!(
        running.join().expect("the host thread returns"),
        RunOutcome::Stopped
    );
}

#[test]
fn a_stop_that_owes_a_failure_returns_a_fatal_outcome() {
    let (addr, stop, running) = serve();
    let _stream = probe(addr);

    stop.request_fatally();

    assert_eq!(
        running.join().expect("the host thread returns"),
        RunOutcome::StoppedFatally
    );
}

#[test]
fn a_second_open_connection_does_not_hold_the_stop() {
    let (addr, stop, running) = serve();
    let _first = probe(addr);
    let _second = probe(addr);

    stop.request();

    assert_eq!(
        running.join().expect("an idle connection holds nothing"),
        RunOutcome::Stopped
    );
}
