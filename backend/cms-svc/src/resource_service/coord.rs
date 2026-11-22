//! The coordinate a report is keyed by, and the address the config gave it.

use std::fmt;
use std::net::SocketAddr;

/// A service name and shard, rendered `Name,shard` as `ServiceCoord.__str__` does.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ServiceCoord {
    name: String,
    shard: i32,
}

impl ServiceCoord {
    /// Names one service shard.
    #[must_use]
    pub fn new(name: impl Into<String>, shard: i32) -> Self {
        Self {
            name: name.into(),
            shard,
        }
    }

    /// Splits `Name,shard` at its last comma, as `service.rindex(",")` does.
    ///
    /// # Errors
    ///
    /// [`CoordError::MissingComma`] when there is no comma, [`CoordError::NotANumber`] when
    /// the tail is not an integer.
    pub fn parse(text: &str) -> Result<Self, CoordError> {
        let (name, shard) = text.rsplit_once(',').ok_or(CoordError::MissingComma)?;
        Ok(Self::new(
            name,
            shard
                .parse()
                .map_err(|_| CoordError::NotANumber(shard.to_owned()))?,
        ))
    }

    /// The service name, as the config spells it.
    #[must_use]
    pub fn name(&self) -> &str {
        &self.name
    }

    /// The shard number.
    #[must_use]
    pub fn shard(&self) -> i32 {
        self.shard
    }
}

impl fmt::Display for ServiceCoord {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{},{}", self.name, self.shard)
    }
}

/// A service that runs on this machine, with the address the config gave it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalService {
    /// Which service, which shard.
    pub coord: ServiceCoord,
    /// Where it listens; the config's notion of "the same machine" is this address's ip.
    pub address: SocketAddr,
}

/// Why a `Name,shard` string could not be read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CoordError {
    /// The string has no comma to split at.
    MissingComma,
    /// The part after the last comma is not a shard number.
    NotANumber(String),
}

impl fmt::Display for CoordError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MissingComma => formatter.write_str("service is not spelled name,shard"),
            Self::NotANumber(shard) => write!(formatter, "shard {shard:?} is not a number"),
        }
    }
}

impl std::error::Error for CoordError {}

#[cfg(test)]
mod tests {
    use super::{CoordError, ServiceCoord};

    #[test]
    fn a_coordinate_renders_the_way_python_renders_it() {
        assert_eq!(
            ServiceCoord::new("LogService", 0).to_string(),
            "LogService,0"
        );
        assert_eq!(ServiceCoord::new("Worker", 12).to_string(), "Worker,12");
    }

    #[test]
    fn parsing_splits_at_the_last_comma() {
        assert_eq!(
            ServiceCoord::parse("Odd,Name,3"),
            Ok(ServiceCoord::new("Odd,Name", 3))
        );
    }

    #[test]
    fn parsing_names_what_it_could_not_read() {
        assert_eq!(
            ServiceCoord::parse("LogService"),
            Err(CoordError::MissingComma)
        );
        assert_eq!(
            ServiceCoord::parse("LogService,one"),
            Err(CoordError::NotANumber("one".to_owned()))
        );
    }
}
