//! The client half of the RPC wire: one blocking connection and one call at a time.
//!
//! [`Client::connect`] opens a socket and returns without starting a worker or
//! retry loop. The service that owns the client decides when to dial again;
//! [`Client::call`] writes one request and waits for exactly one response.

mod error;
mod id;

use std::cell::Cell;
use std::io::{self, ErrorKind, Read, Write};
use std::marker::PhantomData;
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

use cms_proto::{encode, Framer, Request, Response};
use serde_json::{json, Value};

pub use error::ClientError;
use id::next_id;

/// Bytes asked of the socket per read, so a whole reply usually arrives at once.
const READ_CHUNK: usize = 8 * 1024;

/// How long a call waits for its reply before the connection is given up.
///
/// The reference disables a worker that has shown no sign of life for
/// `WORKER_TIMEOUT` (600s, `workerpool.py:64`). A socket read deadline is the
/// same bound one layer lower: without it a hung worker blocks the caller for
/// ever and the daemon stops sweeping. Kept equal to the reference value so a
/// slow but healthy compile is not cut short.
pub const READ_TIMEOUT: Duration = Duration::from_secs(600);

/// The method the convenience [`Client::echo`] calls.
const ECHO_METHOD: &str = "echo";

/// The one argument the common `echo` handler reads.
const STRING_ARGUMENT: &str = "string";

/// A persistent, synchronous connection to one RPC service.
///
/// Calls borrow the client exclusively, so only one request is in flight. The
/// client is not `Sync`; dropping it closes the connection. Reconnection and
/// retry policy belong to the service that owns it.
pub struct Client {
    stream: TcpStream,
    framer: Framer,
    secret: Option<String>,
    _thread_bound: PhantomData<Cell<()>>,
}

impl Client {
    /// Opens one connection to the first address that accepts it.
    ///
    /// The secret is sent only when it is `Some`, matching the Python client's
    /// omission of `__secret` when no secret is configured.
    ///
    /// # Errors
    ///
    /// Returns [`ClientError::Connect`] when the address cannot be resolved or
    /// no endpoint accepts the connection.
    pub fn connect(addr: impl ToSocketAddrs, secret: Option<String>) -> Result<Self, ClientError> {
        Self::connect_with_timeout(addr, secret, READ_TIMEOUT)
    }

    /// Opens a connection with an explicit reply deadline.
    ///
    /// # Errors
    ///
    /// Returns [`ClientError::Connect`] when the address cannot be resolved, no
    /// endpoint accepts the connection, or the deadline cannot be set.
    pub fn connect_with_timeout(
        addr: impl ToSocketAddrs,
        secret: Option<String>,
        timeout: Duration,
    ) -> Result<Self, ClientError> {
        let stream = TcpStream::connect(addr).map_err(ClientError::Connect)?;
        // A worker that stops answering must surface as a failed call, not as a
        // caller blocked for ever; the owner then drops this client and dials
        // again on the next operation.
        stream
            .set_read_timeout(Some(timeout))
            .map_err(ClientError::Connect)?;
        Ok(Self {
            stream,
            framer: Framer::default(),
            secret,
            _thread_bound: PhantomData,
        })
    }

    /// Sends one request and returns the successful response data.
    ///
    /// # Errors
    ///
    /// Returns [`ClientError::Frame`] when the request cannot be encoded,
    /// [`ClientError::Write`] or [`ClientError::Read`] for socket failures,
    /// [`ClientError::Decode`] for a malformed response envelope,
    /// [`ClientError::MismatchedId`] when the reply names another request,
    /// and [`ClientError::Refused`] when the service reports an error.
    pub fn call(&mut self, method: &str, data: Value) -> Result<Value, ClientError> {
        let id = next_id();
        let request = Request {
            id: id.clone(),
            method: method.to_owned(),
            data,
            secret: self.secret.clone(),
        };
        let framed = encode(&request).map_err(ClientError::Frame)?;
        self.stream.write_all(&framed).map_err(ClientError::Write)?;
        let response = self.read_response()?;
        if response.id != id {
            return Err(ClientError::MismatchedId {
                expected: id,
                received: response.id,
            });
        }
        match response.error {
            Some(Value::String(message)) => Err(ClientError::Refused(message)),
            Some(error) => Err(ClientError::Refused(error.to_string())),
            None => Ok(response.data),
        }
    }

    /// Calls the common `echo` method with `text` as its `string` argument.
    ///
    /// # Errors
    ///
    /// Returns the same errors as [`Client::call`].
    pub fn echo(&mut self, text: &str) -> Result<Value, ClientError> {
        self.call(ECHO_METHOD, json!({ STRING_ARGUMENT: text }))
    }

    /// Reads and decodes exactly one response frame.
    fn read_response(&mut self) -> Result<Response, ClientError> {
        let mut chunk = [0_u8; READ_CHUNK];
        loop {
            if let Some(frame) = self.framer.next_frame().map_err(ClientError::Frame)? {
                return serde_json::from_value(frame.value).map_err(ClientError::Decode);
            }
            let read = match self.stream.read(&mut chunk) {
                Ok(0) => {
                    return Err(ClientError::Read(io::Error::new(
                        ErrorKind::UnexpectedEof,
                        "the RPC connection closed before a response",
                    )));
                }
                Ok(read) => read,
                Err(error) if error.kind() == ErrorKind::Interrupted => continue,
                Err(error) => return Err(ClientError::Read(error)),
            };
            self.framer
                .push(&chunk[..read])
                .map_err(ClientError::Frame)?;
        }
    }
}
