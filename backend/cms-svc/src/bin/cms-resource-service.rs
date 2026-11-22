//! The process that supervises this machine's services: seven environment inputs in, one listener out.

use std::env;
use std::fmt;
use std::io;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::mpsc::channel;
use std::thread;
use std::time::Duration;

use cms_proto::GateConfig;
use cms_svc::{
    daemon, handlers, local_services, service, Host, HostError, ProcReader, ProcessSpawner,
    ResourceReader, ResourceService, Sampling, ServiceCoord, TableError, MAX_RESOURCE_SECONDS,
};

/// The `host:port` the RPC listener binds, rendered from `[services] ResourceService`.
const ADDRESS_VARIABLE: &str = "RESOURCE_SERVICE_ADDR";

/// The shared secret every caller must present, rendered from `[rpc] RPC_SECRET`.
const SECRET_VARIABLE: &str = "RPC_SECRET";

/// This service's own coordinate, `ResourceService,shard`, rendered from the same entry.
const COORD_VARIABLE: &str = "RESOURCE_SERVICE_COORD";

/// The `[services]` table, one `Name|shard|host|port` line per shard.
const SERVICES_VARIABLE: &str = "CMS_SERVICES";

/// Whether the restart pass runs, supplied by the container and off unless Python's default is overridden.
const AUTORESTART_VARIABLE: &str = "CMS_AUTORESTART";

/// The contest the restarted services are started for, optional as it is for Python.
const CONTEST_ID_VARIABLE: &str = "CMS_CONTEST_ID";

/// Where the service binaries live, defaulting to this executable's own directory.
const BIN_PATH_VARIABLE: &str = "CMS_BIN_PATH";

/// The gap `_store_resources` is scheduled on, `add_timeout(self._store_resources, None, 5.0)`.
const SAMPLE_INTERVAL: Duration = Duration::from_secs(5);

fn main() -> ExitCode {
    match run() {
        Ok(code) => code,
        Err(error) => {
            eprintln!("cms-resource-service: {error}");
            ExitCode::FAILURE
        }
    }
}

/// Starts the service on the configured address and reports the exit its stop asked for.
fn run() -> Result<ExitCode, StartError> {
    let address = required(ADDRESS_VARIABLE)?;
    let secret = required(SECRET_VARIABLE)?;
    let coord_text = required(COORD_VARIABLE)?;
    let table = required(SERVICES_VARIABLE)?;
    let coord = coordinate(&coord_text)?;
    // WHY here: a table or coordinate this process cannot read is a startup refusal, and it
    // has to name the variable that carried it before anything binds.
    let local = local_services(&table, &coord)?;
    let sampling = Sampling {
        interval: SAMPLE_INTERVAL,
        retention_seconds: MAX_RESOURCE_SECONDS,
    };
    let bin_path = bin_path()?;
    let autorestart = is_autorestart()?;
    let contest_id = contest_id()?;
    // No backdoor: the resource service answers no backdoor method, so the flag could only ever refuse one.
    let config = GateConfig {
        secret: Some(&secret),
        is_backdoor_enabled: false,
    };
    let host = Host::bind(address.as_str(), handlers::methods(), config)?;
    let (mailbox, requests) = channel();
    handlers::install(mailbox).map_err(StartError::Mailbox)?;
    let stop = host.stop_handle();
    thread::Builder::new()
        .name("resource-timer".to_owned())
        .spawn(move || {
            // WHY here: the service borrows its reader and owns its children, so the thread
            // that runs it is the thread that creates it.
            let reader: &'static dyn ResourceReader = Box::leak(Box::new(ProcReader::new()));
            let mut resource = ResourceService::new(
                local,
                coord,
                reader,
                bin_path,
                sampling,
                autorestart,
                contest_id,
            );
            // WHY before serving: the first stored sample needs the counters this pass fixes.
            if let Err(error) = resource.prime(daemon::now_seconds()) {
                eprintln!("cms-resource-service: cannot prime with a sample: {error}");
                stop.request_fatally();
                return;
            }
            let mut spawner = ProcessSpawner::new();
            daemon::serve(&mut resource, &mut spawner, &stop, &requests);
        })
        .map_err(StartError::Thread)?;
    // WHY: `quit` reaches the host through one slot, so the root that bound it is the one that fills it.
    service::attach_stop(host.stop_handle()).map_err(StartError::Stop)?;
    println!("cms-resource-service listening on {}", host.local_addr()?);
    let outcome = host.run()?;
    Ok(if outcome.is_fatal() {
        ExitCode::FAILURE
    } else {
        ExitCode::SUCCESS
    })
}

/// Reads an environment variable the process cannot run without; unset, blank or non-UTF-8 is refused by name.
fn required(name: &'static str) -> Result<String, StartError> {
    match env::var(name) {
        Ok(value) if !value.trim().is_empty() => Ok(value),
        _ => Err(StartError::Missing(name)),
    }
}

/// Reads an environment variable the process can run without; unset or blank is `None`.
fn optional(name: &'static str) -> Option<String> {
    env::var(name).ok().filter(|value| !value.trim().is_empty())
}

/// `ResourceService,shard`, refused by the variable that carried it when it is not that.
fn coordinate(text: &str) -> Result<ServiceCoord, StartError> {
    ServiceCoord::parse(text).map_err(|error| StartError::Malformed {
        variable: COORD_VARIABLE,
        value: text.to_owned(),
        reason: error.to_string(),
    })
}

/// Python's `autorestart=False`: a container that says nothing here supervises nothing.
fn is_autorestart() -> Result<bool, StartError> {
    match optional(AUTORESTART_VARIABLE).as_deref().map(str::trim) {
        None => Ok(false),
        Some("true") => Ok(true),
        Some("false") => Ok(false),
        Some(other) => Err(StartError::Malformed {
            variable: AUTORESTART_VARIABLE,
            value: other.to_owned(),
            reason: "it is neither true nor false".to_owned(),
        }),
    }
}

/// Python's `contest_id=None`: an empty or absent value is the normal deployment, not an error.
fn contest_id() -> Result<Option<i64>, StartError> {
    match optional(CONTEST_ID_VARIABLE) {
        None => Ok(None),
        Some(value) => value
            .trim()
            .parse()
            .map(Some)
            .map_err(|_| StartError::Malformed {
                variable: CONTEST_ID_VARIABLE,
                value: value.clone(),
                reason: "it is not an integer".to_owned(),
            }),
    }
}

/// Where the service binaries live, `_restart_services`'s `BIN_PATH`.
fn bin_path() -> Result<PathBuf, StartError> {
    if let Some(directory) = optional(BIN_PATH_VARIABLE) {
        return Ok(PathBuf::from(directory));
    }
    // WHY defaulted rather than required: the running binary already sits where its siblings do.
    let executable = env::current_exe().map_err(StartError::Executable)?;
    executable
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| StartError::Executable(io::Error::from(io::ErrorKind::NotFound)))
}

/// Why the process did not start.
#[derive(Debug)]
enum StartError {
    /// An environment variable holds no usable value.
    Missing(&'static str),
    /// An environment variable holds a value this process cannot read.
    Malformed {
        /// The variable that carried it.
        variable: &'static str,
        /// The value as the environment held it.
        value: String,
        /// What about it is unusable.
        reason: String,
    },
    /// The service table is unusable.
    Table(TableError),
    /// The running executable's directory could not be read.
    Executable(io::Error),
    /// The timer thread could not be started.
    Thread(io::Error),
    /// The handlers could not be given the mailbox the timer serves.
    Mailbox(String),
    /// The base methods could not be given the host `quit` stops.
    Stop(String),
    /// The listener could not be bound or stopped accepting.
    Host(HostError),
}

impl fmt::Display for StartError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Missing(name) => write!(
                formatter,
                "{name} is unset or empty; the resource service needs it set and will not invent one"
            ),
            Self::Malformed {
                variable,
                value,
                reason,
            } => write!(formatter, "{variable}={value:?} is unusable: {reason}"),
            Self::Table(error) => write!(formatter, "{error}"),
            Self::Executable(error) => {
                write!(formatter, "cannot read the running executable: {error}")
            }
            Self::Thread(error) => write!(formatter, "cannot start the timer thread: {error}"),
            Self::Mailbox(reason) => write!(formatter, "{reason}"),
            Self::Stop(reason) => write!(formatter, "{reason}"),
            Self::Host(error) => write!(formatter, "{error}"),
        }
    }
}

impl std::error::Error for StartError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Missing(_) | Self::Malformed { .. } | Self::Stop(_) | Self::Mailbox(_) => None,
            Self::Table(error) => Some(error),
            Self::Executable(error) | Self::Thread(error) => Some(error),
            Self::Host(error) => Some(error),
        }
    }
}

impl From<TableError> for StartError {
    fn from(error: TableError) -> Self {
        Self::Table(error)
    }
}

impl From<HostError> for StartError {
    fn from(error: HostError) -> Self {
        Self::Host(error)
    }
}
