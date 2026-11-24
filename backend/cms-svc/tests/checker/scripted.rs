//! One-connection peers that script malformed replies the real host cannot produce.

use std::io::{ErrorKind, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use cms_proto::{encode, Framer, Request, Response};
use serde_json::{json, Value};

/// How long the scripted peer waits for the checker's request.
const TIMEOUT: Duration = Duration::from_secs(5);

/// Starts a peer that answers exactly one request.
pub(super) fn serve_once<F>(reply: F) -> (SocketAddr, JoinHandle<Vec<Request>>)
where
    F: FnOnce(&Request) -> Vec<u8> + Send + 'static,
{
    let mut once = Some(reply);
    serve(1, move |request| {
        once.take().expect("one request is answered once")(request)
    })
}

/// Starts a peer that answers two requests on one accepted connection.
pub(super) fn serve_twice<F>(reply: F) -> (SocketAddr, JoinHandle<Vec<Request>>)
where
    F: FnMut(&Request) -> Vec<u8> + Send + 'static,
{
    serve(2, reply)
}

/// Serves `count` requests on one connection, proving whether the client reconnects.
fn serve<F>(count: usize, mut reply: F) -> (SocketAddr, JoinHandle<Vec<Request>>)
where
    F: FnMut(&Request) -> Vec<u8> + Send + 'static,
{
    let listener = TcpListener::bind("127.0.0.1:0").expect("an ephemeral port is bindable");
    let addr = listener.local_addr().expect("the listener has an address");
    let thread = thread::spawn(move || {
        let (mut stream, _peer) = listener.accept().expect("the checker connects once");
        stream
            .set_read_timeout(Some(TIMEOUT))
            .expect("the scripted socket can have a read deadline");
        let mut requests = Vec::with_capacity(count);
        for _ in 0..count {
            let request = read_request(&mut stream);
            let answer = reply(&request);
            stream
                .write_all(&answer)
                .expect("the checker is still reading its reply");
            requests.push(request);
        }
        requests
    });
    (addr, thread)
}

/// Reads one complete request using the production frame decoder.
fn read_request(stream: &mut TcpStream) -> Request {
    let mut framer = Framer::default();
    let mut chunk = [0_u8; 8 * 1024];
    loop {
        if let Some(frame) = framer
            .next_frame()
            .expect("the scripted listener reads a legal frame")
        {
            return serde_json::from_value(frame.value).expect("the checker sends a request");
        }
        match stream.read(&mut chunk) {
            Ok(0) => panic!("the checker closed before sending a request"),
            Ok(read) => framer
                .push(&chunk[..read])
                .expect("the checker sends a frame within the size limit"),
            Err(error) if error.kind() == ErrorKind::Interrupted => continue,
            Err(error) => panic!("the scripted listener cannot read the request: {error}"),
        }
    }
}

/// Frames a successful response carrying `data`.
pub(super) fn reply(request: &Request, data: Value) -> Vec<u8> {
    encode(&Response {
        id: request.id.clone(),
        data,
        error: None,
    })
    .expect("the scripted response fits the size limit")
}

/// Frames an error response whose payload is not a string.
pub(super) fn reply_with_error(request: &Request, error: Value) -> Vec<u8> {
    encode(&Response {
        id: request.id.clone(),
        data: Value::Null,
        error: Some(error),
    })
    .expect("the scripted response fits the size limit")
}

/// The string a well-behaved peer echoes, extracted for test assertions.
pub(super) fn echoed(request: &Request) -> String {
    request.data["string"]
        .as_str()
        .expect("echo carries a string")
        .to_owned()
}

/// Makes the structured error fixture explicit at its call site.
pub(super) fn structured_error() -> Value {
    json!({"reason": "structured failure"})
}
