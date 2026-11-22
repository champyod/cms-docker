//! The `CMS_SERVICES` table: what `[services]` renders as, one `Name|shard|host|port` line per shard.

use std::fmt;
use std::io;
use std::net::{SocketAddr, ToSocketAddrs};

use super::coord::{LocalService, ServiceCoord};

/// What separates the four fields of one line.
const FIELD_SEPARATOR: char = '|';

/// How many fields a line carries.
const FIELDS: usize = 4;

/// The services this machine runs: every row of `table` whose host is `my_coord`'s host.
///
/// This is the port of `ResourceService._find_local_services` (`ResourceService.py:274-290`),
/// which takes the address of its own coordinate and keeps the services sharing it. It lives
/// here rather than in the binary because it is one rule about the table, and a test should be
/// able to read it without starting a process.
///
/// # Errors
///
/// [`TableError::Malformed`] when a line is not `Name|shard|host|port`, [`TableError::NoSelfEntry`]
/// when no line names `my_coord`, and [`TableError::Unresolvable`] when a local host cannot be
/// turned into an address.
pub fn local_services(
    table: &str,
    my_coord: &ServiceCoord,
) -> Result<Vec<LocalService>, TableError> {
    let rows = rows(table)?;
    let my_host = rows
        .iter()
        .find(|row| row.coord == *my_coord)
        .map(|row| row.host.clone())
        .ok_or_else(|| TableError::NoSelfEntry(my_coord.clone()))?;
    rows.iter()
        .filter(|row| row.host == my_host)
        .map(Row::local_service)
        .collect()
}

/// One shard's row of the table, before it becomes a [`LocalService`].
struct Row {
    coord: ServiceCoord,
    host: String,
    port: u16,
}

impl Row {
    fn local_service(&self) -> Result<LocalService, TableError> {
        Ok(LocalService {
            coord: self.coord.clone(),
            address: self.address()?,
        })
    }

    fn address(&self) -> Result<SocketAddr, TableError> {
        // WHY resolved rather than parsed: the config names a compose service, and Host::bind resolves ours the same way.
        let mut addresses = (self.host.as_str(), self.port)
            .to_socket_addrs()
            .map_err(|source| self.unresolvable(source))?;
        addresses
            .next()
            .ok_or_else(|| self.unresolvable(io::Error::from(io::ErrorKind::AddrNotAvailable)))
    }

    fn unresolvable(&self, source: io::Error) -> TableError {
        TableError::Unresolvable {
            host: self.host.clone(),
            port: self.port,
            source,
        }
    }
}

/// Every non-blank line as a row, in the order the table gave them.
fn rows(table: &str) -> Result<Vec<Row>, TableError> {
    table
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(row)
        .collect()
}

fn row(line: &str) -> Result<Row, TableError> {
    let fields: Vec<&str> = line.split(FIELD_SEPARATOR).collect();
    if fields.len() != FIELDS {
        return Err(TableError::Malformed {
            line: line.to_owned(),
            reason: "it is not Name|shard|host|port",
        });
    }
    let (name, host) = (fields[0], fields[2]);
    if name.is_empty() || host.is_empty() {
        return Err(TableError::Malformed {
            line: line.to_owned(),
            reason: "the name and the host cannot be empty",
        });
    }
    let shard = fields[1].parse().map_err(|_| TableError::Malformed {
        line: line.to_owned(),
        reason: "the shard is not an integer",
    })?;
    let port = fields[3].parse().map_err(|_| TableError::Malformed {
        line: line.to_owned(),
        reason: "the port is not a number",
    })?;
    Ok(Row {
        coord: ServiceCoord::new(name, shard),
        host: host.to_owned(),
        port,
    })
}

/// Why a table could not be read.
#[derive(Debug)]
pub enum TableError {
    /// A line is not the four fields a row carries.
    Malformed {
        /// The line as the environment held it.
        line: String,
        /// What about it is unusable.
        reason: &'static str,
    },
    /// No line names the coordinate the process was given.
    NoSelfEntry(ServiceCoord),
    /// A host of this machine could not be turned into an address.
    Unresolvable {
        /// The host the row spelled.
        host: String,
        /// The port the row spelled.
        port: u16,
        /// What the resolver said.
        source: io::Error,
    },
}

impl fmt::Display for TableError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Malformed { line, reason } => {
                write!(
                    formatter,
                    "CMS_SERVICES line {line:?} is unusable: {reason}"
                )
            }
            Self::NoSelfEntry(coord) => write!(
                formatter,
                "RESOURCE_SERVICE_COORD is {coord} but CMS_SERVICES has no such entry"
            ),
            Self::Unresolvable { host, port, source } => {
                write!(
                    formatter,
                    "CMS_SERVICES host {host}:{port} has no address: {source}"
                )
            }
        }
    }
}

impl std::error::Error for TableError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Malformed { .. } | Self::NoSelfEntry(_) => None,
            Self::Unresolvable { source, .. } => Some(source),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{local_services, TableError};
    use crate::resource_service::ServiceCoord;

    fn coord(name: &str, shard: i32) -> ServiceCoord {
        ServiceCoord::new(name, shard)
    }

    fn names(services: &[crate::resource_service::LocalService]) -> Vec<String> {
        services
            .iter()
            .map(|service| service.coord.to_string())
            .collect()
    }

    #[test]
    fn a_row_becomes_the_service_coordinate_and_address_it_names() {
        let table = "LogService|0|10.0.0.1|29000\nResourceService|0|10.0.0.1|28000\n";
        let services =
            local_services(table, &coord("ResourceService", 0)).expect("a readable table");
        assert_eq!(names(&services), ["LogService,0", "ResourceService,0"]);
        assert_eq!(
            services[1].address,
            "10.0.0.1:28000".parse().expect("the row's pair")
        );
    }

    #[test]
    fn another_hosts_services_are_never_supervised() {
        // The `.invalid` host cannot resolve: a row dropped before resolution proves the filter runs first.
        let table = concat!(
            "ResourceService|0|10.0.0.1|28000\n",
            "Worker|0|10.0.0.1|26000\n",
            "Worker|1|192.0.2.7|26001\n",
            "LogService|1|elsewhere.invalid|29001\n",
        );
        let services =
            local_services(table, &coord("ResourceService", 0)).expect("a readable table");
        assert_eq!(names(&services), ["ResourceService,0", "Worker,0"]);
    }

    #[test]
    fn the_coordinate_must_name_a_row() {
        let table = "ResourceService|0|10.0.0.1|28000\n";
        let error =
            local_services(table, &coord("ResourceService", 1)).expect_err("shard 1 has no row");
        assert!(matches!(error, TableError::NoSelfEntry(ref coord) if coord.shard() == 1));
        assert!(error.to_string().contains("RESOURCE_SERVICE_COORD"));
    }

    #[test]
    fn a_line_that_is_not_four_fields_is_refused() {
        for line in [
            "Worker|0|10.0.0.1",
            "Worker|0|10.0.0.1|26000|extra",
            "Worker||10.0.0.1|26000",
            "|0|10.0.0.1|26000",
            "Worker|zero|10.0.0.1|26000",
            "Worker|0|10.0.0.1|port",
            "Worker|0||26000",
        ] {
            let table = format!("{line}\nResourceService|0|10.0.0.1|28000\n");
            let error = local_services(&table, &coord("ResourceService", 0))
                .err()
                .unwrap_or_else(|| panic!("{line:?} must be refused"));
            assert!(
                matches!(error, TableError::Malformed { .. }),
                "{line:?} gave {error}"
            );
            assert!(error.to_string().contains("CMS_SERVICES"));
        }
    }

    #[test]
    fn an_empty_table_names_the_coordinate_it_could_not_find() {
        let error = local_services("", &coord("ResourceService", 0)).expect_err("no row");
        assert!(matches!(error, TableError::NoSelfEntry(_)));
    }
}
