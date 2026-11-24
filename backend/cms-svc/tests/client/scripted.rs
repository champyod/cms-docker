//! A one-connection listener that scripts the next reply.

use std::io::{ErrorKind, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use cms_proto::{encode, Framer, Request, Response};
use serde_json::Value;

/// How long the scripted listener waits for the client's request.
const TIMEOUT: Duration = Duration::from_secs(5);

/// One request as decoded by the client contract and as it appeared on the wire.
pub(crate) struct CapturedRequest {
    /// The decoded protocol request.
    pub(crate) request: Request,
    /// The raw JSON envelope, including keys the typed request may omit.
    pub(crate) envelope: Value,
}

/// Starts a listener that answers one request with the bytes its callback returns.
pub(crate) fn serve_with<F>(reply: F) -> (SocketAddr, JoinHandle<CapturedRequest>)
where
    F: FnOnce(&Request) -> Vec<u8> + Send + 'static,
{
    let listener = TcpListener::bind("127.0.0.1:0").expect("an ephemeral port is bindable");
    let addr = listener
        .local_addr()
        .expect("a bound listener has an address");
    let thread = thread::spawn(move || {
        let mut stream = accept(listener);
        let captured = read_request(&mut stream);
        let response = reply(&captured.request);
        stream
            .write_all(&response)
            .expect("the client is still reading its reply");
        captured
    });
    (addr, thread)
}

/// Starts a listener that answers two requests on one accepted connection.
pub(crate) fn serve_twice<F>(mut reply: F) -> (SocketAddr, JoinHandle<Vec<CapturedRequest>>)
where
    F: FnMut(&Request) -> Vec<u8> + Send + 'static,
{
    let listener = TcpListener::bind("127.0.0.1:0").expect("an ephemeral port is bindable");
    let addr = listener
        .local_addr()
        .expect("a bound listener has an address");
    let thread = thread::spawn(move || {
        let mut stream = accept(listener);
        let mut captured = Vec::with_capacity(2);
        for _ in 0..2 {
            let request = read_request(&mut stream);
            let response = reply(&request.request);
            stream
                .write_all(&response)
                .expect("the client is still reading its reply");
            captured.push(request);
        }
        captured
    });
    (addr, thread)
}

/// Accepts one connection and gives its reads a deadline.
fn accept(listener: TcpListener) -> TcpStream {
    let (stream, _peer) = listener.accept().expect("the client connects once");
    stream
        .set_read_timeout(Some(TIMEOUT))
        .expect("the scripted socket can have a read deadline");
    stream
}

/// Reads one complete request using the production frame decoder.
fn read_request(stream: &mut TcpStream) -> CapturedRequest {
    let mut framer = Framer::default();
    let mut chunk = [0_u8; 8 * 1024];
    loop {
        if let Some(frame) = framer
            .next_frame()
            .expect("the scripted listener reads a legal frame")
        {
            let request = serde_json::from_value(frame.value.clone())
                .expect("the client sends a valid request");
            return CapturedRequest {
                request,
                envelope: frame.value,
            };
        }
        match stream.read(&mut chunk) {
            Ok(0) => panic!("the client closed before sending a request"),
            Ok(read) => framer
                .push(&chunk[..read])
                .expect("the client sends a frame within the size limit"),
            Err(error) if error.kind() == ErrorKind::Interrupted => continue,
            Err(error) => panic!("the scripted listener cannot read the request: {error}"),
        }
    }
}

/// Frames a JSON value exactly as the RPC transport does.
pub(crate) fn frame(value: &Value) -> Vec<u8> {
    let mut framed = serde_json::to_vec(value).expect("the scripted value is JSON");
    framed.extend_from_slice(b"\r\n");
    framed
}

/// Frames a response envelope using the production encoder.
pub(crate) fn response(value: &Response) -> Vec<u8> {
    encode(value).expect("the scripted response fits the size limit")
}
