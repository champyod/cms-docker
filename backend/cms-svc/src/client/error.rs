//! Failures a caller can act on without losing their underlying source.

use std::fmt;
use std::io;

use cms_proto::FrameError;

/// Why an outbound RPC could not return a value.
#[derive(Debug)]
pub enum ClientError {
    /// The remote address could not be resolved or reached.
    Connect(io::Error),
    /// The request could not be written to the connection.
    Write(io::Error),
    /// The connection failed before a whole response arrived.
    Read(io::Error),
    /// A request or response could not be framed within the protocol limit.
    Frame(FrameError),
    /// A framed response was not a valid response envelope.
    Decode(serde_json::Error),
    /// The service answered with a non-null `__error`.
    Refused(String),
    /// The response belongs to a different request.
    MismatchedId {
        /// The id generated for this call.
        expected: String,
        /// The id carried by the response.
        received: String,
    },
}

impl fmt::Display for ClientError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Connect(error) => write!(formatter, "cannot connect to the RPC service: {error}"),
            Self::Write(error) => write!(formatter, "cannot write the RPC request: {error}"),
            Self::Read(error) => write!(formatter, "cannot read the RPC response: {error}"),
            Self::Frame(error) => write!(formatter, "RPC framing failed: {error}"),
            Self::Decode(error) => write!(formatter, "cannot decode the RPC response: {error}"),
            Self::Refused(message) => write!(formatter, "RPC call refused: {message}"),
            Self::MismatchedId { expected, received } => write!(
                formatter,
                "RPC response id {received} does not match request id {expected}"
            ),
        }
    }
}

impl std::error::Error for ClientError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Connect(error) | Self::Write(error) | Self::Read(error) => Some(error),
            Self::Frame(error) => Some(error),
            Self::Decode(error) => Some(error),
            Self::Refused(_) | Self::MismatchedId { .. } => None,
        }
    }
}
