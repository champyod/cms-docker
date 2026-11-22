//! The process that runs the logger: three environment inputs in, one listener out.

use std::env;
use std::fmt;
use std::path::Path;
use std::process::ExitCode;

use cms_proto::GateConfig;
use cms_svc::{service, FormatterSettings, Host, HostError, LogError, LogService};

/// The `host:port` the RPC listener binds, rendered from `[services] LogService`.
const ADDRESS_VARIABLE: &str = "LOG_SERVICE_ADDR";

/// The shared secret every caller must present, rendered from `[rpc] RPC_SECRET`.
const SECRET_VARIABLE: &str = "RPC_SECRET";

/// The directory the log files are kept under, rendered from `[global] log_dir`.
const LOG_DIR_VARIABLE: &str = "LOG_DIR";

fn main() -> ExitCode {
    match run() {
        Ok(code) => code,
        Err(error) => {
            eprintln!("cms-log-service: {error}");
            ExitCode::FAILURE
        }
    }
}

/// Starts the service on the configured address and reports the exit its stop asked for.
fn run() -> Result<ExitCode, StartError> {
    let address = required(ADDRESS_VARIABLE)?;
    let secret = required(SECRET_VARIABLE)?;
    let log_dir = required(LOG_DIR_VARIABLE)?;
    let service = LogService::new(Path::new(&log_dir), FormatterSettings::UTC)?;
    // No backdoor: the logger answers no backdoor method, so the flag could only ever refuse one.
    let config = GateConfig {
        secret: Some(&secret),
        is_backdoor_enabled: false,
    };
    let host = Host::bind(address.as_str(), service.methods(), config)?;
    // WHY: `quit` reaches the host through one slot, so the root that bound it is the one that fills it.
    service::attach_stop(host.stop_handle()).map_err(StartError::Stop)?;
    println!("cms-log-service listening on {}", host.local_addr()?);
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

/// Why the process did not start.
#[derive(Debug)]
enum StartError {
    /// An environment variable holds no usable value.
    Missing(&'static str),
    /// The log file could not be opened.
    Log(LogError),
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
                "{name} is unset or empty; the logger needs it set and will not invent one"
            ),
            Self::Log(error) => write!(formatter, "{error}"),
            Self::Stop(reason) => write!(formatter, "{reason}"),
            Self::Host(error) => write!(formatter, "{error}"),
        }
    }
}

impl std::error::Error for StartError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Missing(_) | Self::Stop(_) => None,
            Self::Log(error) => Some(error),
            Self::Host(error) => Some(error),
        }
    }
}

impl From<LogError> for StartError {
    fn from(error: LogError) -> Self {
        Self::Log(error)
    }
}

impl From<HostError> for StartError {
    fn from(error: HostError) -> Self {
        Self::Host(error)
    }
}
