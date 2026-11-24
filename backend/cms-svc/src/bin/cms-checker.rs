//! The Checker process: required service table in, one RPC listener and one timer out.

use std::process::ExitCode;
use std::thread;
use std::time::{Duration, Instant};
use std::{env, fmt, io};

use cms_proto::GateConfig;
use cms_svc::{checker::Checker, daemon, service, CheckerError, Host, HostError, Stop};

/// The listener port Python's Checker uses by default.
const DEFAULT_PORT: u16 = 22000;

/// The only shard the default single Checker deployment runs.
const DEFAULT_SHARD: i32 = 0;

/// The gap between liveness rounds, as `Checker.py:44` schedules it.
const CHECK_INTERVAL: Duration = Duration::from_secs(90);

/// How long an idle timer waits before looking for a stop again.
const STOP_POLL: Duration = Duration::from_millis(50);

const PORT_VARIABLE: &str = "CHECKER_SERVICE_PORT";
const SHARD_VARIABLE: &str = "CHECKER_SERVICE_SHARD";
const SECRET_VARIABLE: &str = "RPC_SECRET";
const SERVICES_VARIABLE: &str = "CMS_SERVICES";

fn main() -> ExitCode {
    match run() {
        Ok(code) => code,
        Err(error) => {
            eprintln!("cms-checker: {error}");
            ExitCode::FAILURE
        }
    }
}

/// Starts the host and its timer, then reports the exit its stop asked for.
fn run() -> Result<ExitCode, StartError> {
    let port = port()?;
    let shard = shard()?;
    let secret = optional(SECRET_VARIABLE);
    let table = required(SERVICES_VARIABLE)?;
    let checker = Checker::new(&table).map_err(StartError::Services)?;
    let checker = checker.with_secret(secret.clone());
    let config = GateConfig {
        secret: secret.as_deref(),
        is_backdoor_enabled: false,
    };
    let host = Host::bind(format!("0.0.0.0:{port}"), service::methods(), (), config)?;
    let stop = host.stop_handle();
    service::attach_stop(stop.clone()).map_err(StartError::Stop)?;
    thread::Builder::new()
        .name(format!("checker-timer-{shard}"))
        .spawn(move || serve(checker, &stop))
        .map_err(StartError::Thread)?;
    println!("cms-checker listening on {}", host.local_addr()?);
    let outcome = host.run()?;
    Ok(if outcome.is_fatal() {
        ExitCode::FAILURE
    } else {
        ExitCode::SUCCESS
    })
}

/// Runs one round immediately, then waits out each interval in short stop-aware sleeps.
fn serve(mut checker: Checker, stop: &Stop) {
    loop {
        let started = Instant::now();
        checker.check_once(daemon::now_seconds());
        wait_until(started + CHECK_INTERVAL, stop);
        if stop.is_requested() {
            return;
        }
    }
}

/// Waits only until `deadline`, returning early when the host is asked to stop.
fn wait_until(deadline: Instant, stop: &Stop) {
    while !stop.is_requested() {
        let now = Instant::now();
        if now >= deadline {
            return;
        }
        thread::sleep((deadline - now).min(STOP_POLL));
    }
}

/// Reads an environment variable the process cannot run without.
fn required(name: &'static str) -> Result<String, StartError> {
    match env::var(name) {
        Ok(value) if !value.trim().is_empty() => Ok(value),
        _ => Err(StartError::Missing(name)),
    }
}

/// Reads an environment variable the process can run without.
fn optional(name: &'static str) -> Option<String> {
    env::var(name).ok().filter(|value| !value.trim().is_empty())
}

/// Python's default port, overridden only by a readable `CHECKER_SERVICE_PORT`.
fn port() -> Result<u16, StartError> {
    number(PORT_VARIABLE, DEFAULT_PORT)
}

/// Python's default shard, overridden only by a readable `CHECKER_SERVICE_SHARD`.
fn shard() -> Result<i32, StartError> {
    number(SHARD_VARIABLE, DEFAULT_SHARD)
}

/// Parses an optional integer, naming the variable when its value is unusable.
fn number<T>(variable: &'static str, default: T) -> Result<T, StartError>
where
    T: std::str::FromStr,
{
    parse_number(optional(variable), variable, default)
}

/// Parses one already-read optional value so defaults can be tested without global environment state.
fn parse_number<T>(
    value: Option<String>,
    variable: &'static str,
    default: T,
) -> Result<T, StartError>
where
    T: std::str::FromStr,
{
    match value {
        None => Ok(default),
        Some(value) => value.trim().parse().map_err(|_| StartError::Malformed {
            variable,
            value,
            reason: "it is not an integer".to_owned(),
        }),
    }
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
    /// The service table or one of its rows is unusable.
    Services(CheckerError),
    /// The timer thread could not be started.
    Thread(io::Error),
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
                "{name} is unset or empty; the checker needs it set and will not invent one"
            ),
            Self::Malformed {
                variable,
                value,
                reason,
            } => write!(formatter, "{variable}={value:?} is unusable: {reason}"),
            Self::Services(error) => write!(formatter, "{SERVICES_VARIABLE} is unusable: {error}"),
            Self::Thread(error) => write!(formatter, "cannot start the checker timer: {error}"),
            Self::Stop(reason) => write!(formatter, "{reason}"),
            Self::Host(error) => write!(formatter, "{error}"),
        }
    }
}

impl std::error::Error for StartError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Missing(_) | Self::Malformed { .. } | Self::Stop(_) => None,
            Self::Services(error) => Some(error),
            Self::Thread(error) => Some(error),
            Self::Host(error) => Some(error),
        }
    }
}

impl From<HostError> for StartError {
    fn from(error: HostError) -> Self {
        Self::Host(error)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::mpsc::channel;
    use std::thread;
    use std::time::{Duration, Instant};

    use super::{
        parse_number, wait_until, CHECK_INTERVAL, DEFAULT_PORT, DEFAULT_SHARD, PORT_VARIABLE,
    };
    use cms_svc::Stop;

    #[test]
    fn absent_optional_numbers_keep_python_defaults() {
        assert_eq!(
            parse_number(None, PORT_VARIABLE, DEFAULT_PORT).expect("the default port"),
            DEFAULT_PORT
        );
        assert_eq!(
            parse_number(None, PORT_VARIABLE, DEFAULT_SHARD).expect("the default shard"),
            DEFAULT_SHARD
        );
    }

    #[test]
    fn optional_numbers_are_trimmed_and_parsed() {
        assert_eq!(
            parse_number(Some(" 22001 ".to_owned()), PORT_VARIABLE, DEFAULT_PORT)
                .expect("the explicit port"),
            22001
        );
        assert_eq!(
            parse_number(Some(" 2 ".to_owned()), PORT_VARIABLE, DEFAULT_SHARD)
                .expect("the explicit shard"),
            2
        );
    }

    #[test]
    fn an_unreadable_optional_number_names_its_variable() {
        let error = parse_number(Some("port".to_owned()), PORT_VARIABLE, DEFAULT_PORT)
            .expect_err("a word is not a port");
        assert!(
            matches!(error, super::StartError::Malformed { variable, .. } if variable == PORT_VARIABLE)
        );
    }

    #[test]
    fn a_requested_stop_ends_a_ninety_second_wait_at_once() {
        let stop = Stop::new();
        stop.request();
        let (sender, receiver) = channel();

        thread::spawn(move || {
            wait_until(Instant::now() + CHECK_INTERVAL, &stop);
            let _ = sender.send(());
        });

        receiver
            .recv_timeout(Duration::from_secs(1))
            .expect("a stopped host does not sleep out the interval");
    }
}
