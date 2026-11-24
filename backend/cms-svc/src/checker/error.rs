//! Why a checker could not be built, or why one peer's round failed.

use std::fmt;

use crate::{ClientError, ServiceCoord, TableError};

/// A failure confined to the checker or one peer in a round.
#[derive(Debug)]
pub enum CheckerError {
    /// The service table could not be parsed or resolved.
    Table(TableError),
    /// An outbound call to one peer failed.
    Rpc {
        /// The peer the call was meant for.
        coord: ServiceCoord,
        /// What the client could not do.
        source: ClientError,
    },
    /// A successful RPC carried an answer the checker could not use.
    InvalidReply {
        /// The peer that sent the answer.
        coord: ServiceCoord,
        /// What about the answer was unusable.
        reason: &'static str,
    },
}

impl fmt::Display for CheckerError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Table(error) => write!(formatter, "{error}"),
            Self::Rpc { coord, source } => write!(formatter, "{coord}: {source}"),
            Self::InvalidReply { coord, reason } => {
                write!(formatter, "{coord}: echo answer mis-shapen: {reason}")
            }
        }
    }
}

impl std::error::Error for CheckerError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Table(error) => Some(error),
            Self::Rpc { source, .. } => Some(source),
            Self::InvalidReply { .. } => None,
        }
    }
}

impl From<TableError> for CheckerError {
    fn from(error: TableError) -> Self {
        Self::Table(error)
    }
}
