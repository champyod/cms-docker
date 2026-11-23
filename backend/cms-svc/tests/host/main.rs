//! The host driven over a real socket: a listener on an ephemeral port, and a client that speaks the wire.

mod answers;
mod framing;
mod refusals;
mod service;
mod stopping;

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::thread;
use std::time::Duration;

use cms_proto::{GateConfig, Method};
use cms_svc::Host;
use serde_json::Value;

/// The secret every host here is configured with.
pub(crate) const SECRET: &str = "correct horse battery";

/// How long a client waits before it calls the host unresponsive.
const TIMEOUT: Duration = Duration::from_secs(5);

/// Answers with the arguments the gate handed it.
pub(crate) fn answer_with_arguments(data: &Value, _context: &()) -> Result<Value, String> {
    Ok(data.clone())
}

/// A method another service may call.
pub(crate) fn callable(
    name: &'static str,
    handler: fn(&Value, &()) -> Result<Value, String>,
) -> Method<()> {
    Method {
        name,
        is_callable: true,
        handler,
    }
}

/// A method this service exposes but does not let another service reach.
pub(crate) fn uncallable(
    name: &'static str,
    handler: fn(&Value, &()) -> Result<Value, String>,
) -> Method<()> {
    Method {
        name,
        is_callable: false,
        handler,
    }
}

/// Starts a host on an ephemeral port; the listener accepts from bind, so no test waits or sleeps.
pub(crate) fn start(methods: Vec<Method<()>>, secret: Option<&str>) -> SocketAddr {
    let config = GateConfig {
        secret,
        is_backdoor_enabled: false,
    };
    let host =
        Host::bind("127.0.0.1:0", methods, (), config).expect("an ephemeral port is bindable");
    let addr = host
        .local_addr()
        .expect("a bound listener reports its address");
    thread::spawn(move || {
        host.run()
            .expect("the listener keeps accepting for the life of the test");
    });
    addr
}

/// Connects to the host with a deadline on every read, so a missing answer fails instead of hanging.
pub(crate) fn connect(addr: SocketAddr) -> TcpStream {
    let stream = TcpStream::connect(addr).expect("the host is listening");
    stream
        .set_read_timeout(Some(TIMEOUT))
        .expect("a read deadline can be set on the test socket");
    stream
}

/// Writes raw bytes, the terminator included by the caller.
pub(crate) fn send(stream: &mut TcpStream, bytes: &[u8]) {
    stream
        .write_all(bytes)
        .expect("the host is still reading this connection");
}

/// Frames one envelope as the Python transport frames it.
pub(crate) fn wire(envelope: &Value) -> Vec<u8> {
    let mut framed = serde_json::to_vec(envelope).expect("an envelope is JSON");
    framed.extend_from_slice(b"\r\n");
    framed
}

/// Reads one framed reply; a connection that ends first fails the test.
pub(crate) fn read_reply(stream: &mut TcpStream) -> Value {
    let mut received = Vec::new();
    while !received.ends_with(b"\r\n") {
        let mut byte = [0_u8; 1];
        match stream.read(&mut byte) {
            Ok(0) => panic!(
                "the connection closed after {} bytes, before a whole reply",
                received.len()
            ),
            Ok(_) => received.push(byte[0]),
            Err(error) => panic!("no reply arrived: {error}"),
        }
    }
    serde_json::from_slice(&received[..received.len() - 2]).expect("the reply is JSON")
}

/// Reads whatever the host wrote before it closed the connection.
pub(crate) fn read_until_closed(stream: &mut TcpStream) -> Vec<u8> {
    let mut received = Vec::new();
    stream
        .read_to_end(&mut received)
        .expect("the host closes the connection");
    received
}
