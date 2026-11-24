//! The process that runs one worker: environment inputs in, one RPC listener out.
//!
//! The settings are read before a cache is opened or a socket is bound. The
//! grading runtime, shared filesystem store and typed runner are then built
//! once and handed to the worker, whose method table carries the base RPC calls
//! beside `execute_job_group`. The host owns the listener; this composition root
//! only gives `quit` the handle that stops it and reports the bound address.

#![forbid(unsafe_code)]

use std::fmt;
use std::process::ExitCode;

use cms_grading::stage::FsCache;
use cms_grading::tasktypes::Runtime;
use cms_proto::GateConfig;
use cms_svc::{service, Host, HostError};
use cms_worker::api::Worker;
use cms_worker::run::Runner;
use cms_worker::settings::{Settings, SettingsError};

/// The task type names the reference registers for a worker.
const TASK_TYPES: [&str; 5] = [
    "Batch",
    "BatchAndOutput",
    "OutputOnly",
    "TwoSteps",
    "Communication",
];

fn main() -> ExitCode {
    match run() {
        Ok(code) => code,
        Err(error) => {
            eprintln!("cms-worker: {error}");
            ExitCode::FAILURE
        }
    }
}

/// Starts the worker and reports the exit its stop asked for.
fn run() -> Result<ExitCode, StartError> {
    let settings = Settings::from_env().map_err(StartError::Settings)?;
    let runtime = Runtime::new(
        settings.sandbox_program,
        settings.temp_dir,
        settings.compilation_limits,
        settings.max_file_size,
        settings.trusted_limits,
    );
    let cache = FsCache::at(settings.cache_dir).map_err(StartError::Cache)?;
    let runner = Runner::new(runtime, cache);
    let worker = Worker::new(
        settings.shard,
        TASK_TYPES.into_iter().map(str::to_owned).collect(),
        runner,
    );
    // No backdoor: the worker answers no backdoor method, so the flag could only ever refuse one.
    let config = GateConfig {
        secret: Some(&settings.secret),
        is_backdoor_enabled: false,
    };
    let host = Host::bind(settings.bind_address, Worker::methods(), worker, config)
        .map_err(StartError::Host)?;
    // WHY: `quit` reaches the host through one slot, so the root that bound it is the one that fills it.
    service::attach_stop(host.stop_handle()).map_err(StartError::Stop)?;
    println!(
        "cms-worker listening on {}",
        host.local_addr().map_err(StartError::Host)?
    );
    let outcome = host.run().map_err(StartError::Host)?;
    Ok(if outcome.is_fatal() {
        ExitCode::FAILURE
    } else {
        ExitCode::SUCCESS
    })
}

/// Why the process did not start or keep serving.
#[derive(Debug)]
enum StartError {
    /// An environment input could not become worker settings.
    Settings(SettingsError),
    /// The shared filesystem store could not be opened.
    Cache(cms_grading::stage::StageError),
    /// The base methods could not be given the host `quit` stops.
    Stop(String),
    /// The listener could not be bound, read or run.
    Host(HostError),
}

impl fmt::Display for StartError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Settings(error) => write!(formatter, "{error}"),
            Self::Cache(error) => write!(formatter, "{error}"),
            Self::Stop(reason) => write!(formatter, "{reason}"),
            Self::Host(error) => write!(formatter, "{error}"),
        }
    }
}

impl std::error::Error for StartError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Settings(error) => Some(error),
            Self::Cache(error) => Some(error),
            Self::Stop(_) => None,
            Self::Host(error) => Some(error),
        }
    }
}
