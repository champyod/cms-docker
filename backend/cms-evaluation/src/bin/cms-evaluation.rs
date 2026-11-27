//! The EvaluationService daemon: environment inputs, one RPC host and two loops.
//!
//! `DATABASE_URL` is required. The listener defaults to `0.0.0.0:25000`, with
//! its port and shard overridden by `EVALUATION_SERVICE_PORT` and
//! `EVALUATION_SERVICE_SHARD`. `RPC_SECRET` authenticates callers;
//! `SCORING_SERVICE_ADDR` enables post-verdict notification; and
//! `WORKER_SERVICE_ADDRS` is the comma-separated shard list the dispatcher
//! dials. An empty worker list leaves the sweeper running but no job dispatched.

#![forbid(unsafe_code)]

use std::env;
use std::fmt;
use std::io;
use std::net::SocketAddr;
use std::process::ExitCode;
use std::str::FromStr;
use std::sync::Arc;

use cms_db::{Session, SessionConfig, SessionError};
use cms_proto::GateConfig;
use cms_svc::{service, Host, HostError};
use tokio::runtime::Runtime;
use tokio::task::{JoinError, JoinHandle};

use cms_evaluation::run::{self, RunError};
use cms_evaluation::{Evaluation, WorkerDispatcher};

const DATABASE_URL_VARIABLE: &str = "DATABASE_URL";
const PORT_VARIABLE: &str = "EVALUATION_SERVICE_PORT";
const SHARD_VARIABLE: &str = "EVALUATION_SERVICE_SHARD";
const SECRET_VARIABLE: &str = "RPC_SECRET";
const SCORING_ADDRESS_VARIABLE: &str = "SCORING_SERVICE_ADDR";
const WORKER_ADDRESSES_VARIABLE: &str = "WORKER_SERVICE_ADDRS";
const DEFAULT_PORT: u16 = 25_000;
const DEFAULT_SHARD: i32 = 0;

fn main() -> ExitCode {
    match run() {
        Ok(code) => code,
        Err(error) => {
            eprintln!("cms-evaluation: {error}");
            ExitCode::FAILURE
        }
    }
}

/// Starts the daemon and reports the exit its stop asked for.
fn run() -> Result<ExitCode, StartError> {
    let settings = Settings::from_env()?;
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .thread_name(format!("cms-evaluation-{}", settings.shard))
        .enable_all()
        .build()
        .map_err(StartError::Runtime)?;
    let session = open_session(&runtime, &settings)?;
    let evaluation = Evaluation::new(
        Arc::new(session),
        runtime.handle().clone(),
        settings.scoring_address.clone(),
        settings.secret.clone(),
    );
    let host = bind_host(evaluation.clone(), &settings)?;
    let loops = start_loops(
        &runtime,
        evaluation,
        WorkerDispatcher::new(settings.worker_addresses.clone(), settings.secret.clone()),
        host.stop_handle(),
    )?;
    println!(
        "cms-evaluation listening on {}",
        host.local_addr().map_err(StartError::Host)?
    );
    let outcome = host.run().map_err(StartError::Host)?;
    finish_loops(&runtime, loops)?;
    Ok(if outcome.is_fatal() {
        ExitCode::FAILURE
    } else {
        ExitCode::SUCCESS
    })
}

fn open_session(runtime: &Runtime, settings: &Settings) -> Result<Session, StartError> {
    runtime
        .block_on(Session::open(&SessionConfig::new(
            settings.database_url.clone(),
        )))
        .map_err(StartError::Database)
}

fn bind_host(evaluation: Evaluation, settings: &Settings) -> Result<Host<Evaluation>, StartError> {
    let config = GateConfig {
        secret: settings.secret.as_deref(),
        is_backdoor_enabled: false,
    };
    let host = Host::bind(
        format!("0.0.0.0:{}", settings.port),
        Evaluation::methods(),
        evaluation,
        config,
    )
    .map_err(StartError::Host)?;
    service::attach_stop(host.stop_handle()).map_err(StartError::Stop)?;
    Ok(host)
}

struct Loops {
    sweeper: JoinHandle<()>,
    monitor: JoinHandle<Result<(), StartError>>,
}

fn start_loops(
    runtime: &Runtime,
    evaluation: Evaluation,
    dispatcher: WorkerDispatcher,
    stop: cms_svc::Stop,
) -> Result<Loops, StartError> {
    let shared = Arc::new(evaluation);
    let sweeper = runtime.spawn(run::sweeper(Arc::clone(&shared), stop.clone()));
    let worker = runtime.spawn(run::worker(Arc::clone(&shared), dispatcher, stop.clone()));
    let worker_stop = stop;
    let monitor = runtime.spawn(async move {
        match worker.await {
            Ok(Ok(())) => Ok(()),
            Ok(Err(error)) => {
                worker_stop.request_fatally();
                Err(StartError::Loop(error))
            }
            Err(error) => {
                worker_stop.request_fatally();
                Err(StartError::Task(error))
            }
        }
    });
    Ok(Loops { sweeper, monitor })
}

fn finish_loops(runtime: &Runtime, loops: Loops) -> Result<(), StartError> {
    runtime
        .block_on(loops.monitor)
        .map_err(StartError::Task)??;
    runtime.block_on(loops.sweeper).map_err(StartError::Task)?;
    Ok(())
}

struct Settings {
    database_url: String,
    port: u16,
    shard: i32,
    secret: Option<String>,
    scoring_address: Option<String>,
    worker_addresses: Vec<SocketAddr>,
}

impl Settings {
    fn from_env() -> Result<Self, StartError> {
        Ok(Self {
            database_url: required(DATABASE_URL_VARIABLE)?,
            port: number(PORT_VARIABLE, DEFAULT_PORT)?,
            shard: number(SHARD_VARIABLE, DEFAULT_SHARD)?,
            secret: optional(SECRET_VARIABLE),
            scoring_address: optional(SCORING_ADDRESS_VARIABLE),
            worker_addresses: addresses(optional(WORKER_ADDRESSES_VARIABLE))?,
        })
    }
}

fn required(name: &'static str) -> Result<String, StartError> {
    match env::var(name) {
        Ok(value) if !value.trim().is_empty() => Ok(value.trim().to_owned()),
        _ => Err(StartError::Missing(name)),
    }
}

fn optional(name: &'static str) -> Option<String> {
    env::var(name)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn number<T>(variable: &'static str, default: T) -> Result<T, StartError>
where
    T: FromStr,
{
    let Some(value) = optional(variable) else {
        return Ok(default);
    };
    value
        .parse()
        .map_err(|_| StartError::Malformed { variable, value })
}

/// Parses the comma-separated shard list; an absent list means no workers.
fn addresses(value: Option<String>) -> Result<Vec<SocketAddr>, StartError> {
    let Some(value) = value else {
        return Ok(Vec::new());
    };
    value
        .split(',')
        .map(|part| {
            part.trim().parse().map_err(|_| StartError::Malformed {
                variable: WORKER_ADDRESSES_VARIABLE,
                value: part.trim().to_owned(),
            })
        })
        .collect()
}

/// Why the process did not start or keep serving.
#[derive(Debug)]
enum StartError {
    /// A required environment variable was absent or empty.
    Missing(&'static str),
    /// A numeric or address environment variable could not be parsed.
    Malformed {
        /// The variable that carried the unusable value.
        variable: &'static str,
        /// The value as the environment held it.
        value: String,
    },
    /// The multi-thread runtime could not be built.
    Runtime(io::Error),
    /// The database session could not be opened.
    Database(SessionError),
    /// A background loop failed.
    Loop(RunError),
    /// A background task could not be joined.
    Task(JoinError),
    /// The base methods could not be given the host `quit` stops.
    Stop(String),
    /// The listener could not be bound, read or run.
    Host(HostError),
}

impl fmt::Display for StartError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Missing(name) => write!(
                formatter,
                "{name} is unset or empty; the evaluation service needs it set and will not invent one"
            ),
            Self::Malformed { variable, value } => write!(
                formatter,
                "{variable}={value:?} is unusable: it is not a valid value"
            ),
            Self::Runtime(error) => write!(formatter, "cannot start the evaluation runtime: {error}"),
            Self::Database(error) => write!(formatter, "cannot open the evaluation session: {error}"),
            Self::Loop(error) => write!(formatter, "the evaluation worker failed: {error}"),
            Self::Task(error) => write!(formatter, "an evaluation background task failed: {error}"),
            Self::Stop(reason) => write!(formatter, "{reason}"),
            Self::Host(error) => write!(formatter, "{error}"),
        }
    }
}

impl std::error::Error for StartError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Runtime(error) => Some(error),
            Self::Database(error) => Some(error),
            Self::Loop(error) => Some(error),
            Self::Task(error) => Some(error),
            Self::Host(error) => Some(error),
            Self::Missing(_) | Self::Malformed { .. } | Self::Stop(_) => None,
        }
    }
}
