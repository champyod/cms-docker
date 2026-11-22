//! Why a sample or a query could not answer, kept apart from the state machine.

use super::coord::{CoordError, ServiceCoord};
use super::spawn::SpawnError;
use crate::resource::ReadError;

/// Why a sample or a query could not answer.
#[derive(Debug)]
pub enum ResourceError {
    /// The machine or a process could not be read.
    Read(ReadError),
    /// Two samples share an instant, so there is no gap for a percentage to divide by.
    NoElapsedTime,
    /// A service was not spelled `Name,shard`.
    Coord(CoordError),
    /// The coordinate names no service this machine runs.
    UnknownService(ServiceCoord),
    /// A child could not be started, or its name has no binary spelling.
    Spawn(SpawnError),
}

impl std::fmt::Display for ResourceError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Read(error) => write!(formatter, "{error}"),
            Self::NoElapsedTime => formatter.write_str("no time elapsed since the previous sample"),
            Self::Coord(error) => write!(formatter, "{error}"),
            Self::UnknownService(coord) => write!(formatter, "{coord} is not a local service"),
            Self::Spawn(error) => write!(formatter, "{error}"),
        }
    }
}

impl std::error::Error for ResourceError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Read(error) => Some(error),
            Self::Coord(error) => Some(error),
            Self::Spawn(error) => Some(error),
            Self::NoElapsedTime | Self::UnknownService(_) => None,
        }
    }
}

impl From<ReadError> for ResourceError {
    fn from(error: ReadError) -> Self {
        Self::Read(error)
    }
}

impl From<CoordError> for ResourceError {
    fn from(error: CoordError) -> Self {
        Self::Coord(error)
    }
}

impl From<SpawnError> for ResourceError {
    fn from(error: SpawnError) -> Self {
        Self::Spawn(error)
    }
}
