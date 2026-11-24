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

use cms_db::FileCacheError;
use cms_grading::stage::FsCache;
use cms_grading::tasktypes::Runtime;
use cms_proto::GateConfig;
use cms_svc::{service, Host, HostError};
use cms_worker::api::Worker;
use cms_worker::precache::Precache;
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
    let worker = build_worker(&settings)?;
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

/// Builds the runtime, store and typed runner one worker shares across requests.
fn build_worker(settings: &Settings) -> Result<Worker, StartError> {
    let runtime = Runtime::new(
        settings.sandbox_program.clone(),
        settings.temp_dir.clone(),
        settings.compilation_limits,
        settings.max_file_size,
        settings.trusted_limits,
    )
    .with_keep_sandbox(settings.keep_sandbox);
    let cache = FsCache::at(settings.shared_file_dir()).map_err(StartError::Cache)?;
    let runner = Runner::new(runtime, cache);
    let worker = Worker::new(
        settings.shard,
        TASK_TYPES.into_iter().map(str::to_owned).collect(),
        runner,
    );
    let Some(database_url) = settings.database_url.as_deref() else {
        return Ok(worker);
    };
    let precache = Precache::new(
        database_url,
        settings.temp_dir.clone(),
        settings.cache_dir.clone(),
    )
    .map_err(StartError::Precache)?;
    Ok(worker.with_precache(precache))
}

/// Why the process did not start or keep serving.
#[derive(Debug)]
enum StartError {
    /// An environment input could not become worker settings.
    Settings(SettingsError),
    /// The shared filesystem store could not be opened.
    Cache(cms_grading::stage::StageError),
    /// The database-backed precache could not be opened.
    Precache(FileCacheError),
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
            Self::Precache(error) => write!(formatter, "{error}"),
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
            Self::Precache(error) => Some(error),
            Self::Stop(_) => None,
            Self::Host(error) => Some(error),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::io::{Read, Write};
    use std::net::{SocketAddr, TcpStream};
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::mpsc;
    use std::thread;
    use std::time::Duration;

    use cms_grading::steps::TrustedLimits;
    use cms_grading::tasktypes::CompilationLimits;
    use cms_proto::{GateConfig, Shard};
    use cms_svc::{service, Host, RunOutcome};
    use serde_json::{json, Value};

    use super::build_worker;
    use cms_worker::api::Worker;
    use cms_worker::settings::Settings;

    const SECRET: &str = "worker host test secret";
    const TIMEOUT: Duration = Duration::from_secs(5);
    static SANDBOX_SEQUENCE: AtomicU64 = AtomicU64::new(0);

    struct Sandbox {
        path: PathBuf,
    }

    impl Sandbox {
        fn new() -> Self {
            loop {
                let sequence = SANDBOX_SEQUENCE.fetch_add(1, Ordering::Relaxed);
                let path = std::env::temp_dir()
                    .join(format!("cms-worker-{}-{sequence}", std::process::id()));
                match fs::create_dir(&path) {
                    Ok(()) => return Self { path },
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                    Err(error) => panic!("cannot create {}: {error}", path.display()),
                }
            }
        }
    }

    impl Drop for Sandbox {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.path).expect("the test sandbox is removable");
        }
    }

    fn settings(sandbox: &Sandbox, database_url: Option<&str>) -> Settings {
        Settings {
            shard: Shard::new(0),
            bind_address: "127.0.0.1:0".parse().expect("the test address is valid"),
            secret: SECRET.to_owned(),
            database_url: database_url.map(str::to_owned),
            cache_dir: sandbox.path.join("cache"),
            temp_dir: sandbox.path.join("tmp"),
            sandbox_program: PathBuf::from("isolate"),
            keep_sandbox: false,
            max_file_size: None,
            compilation_limits: CompilationLimits::default(),
            trusted_limits: TrustedLimits::new(1, Duration::from_secs(1), 1024),
        }
    }

    fn connect(addr: SocketAddr) -> TcpStream {
        let stream = TcpStream::connect(addr).expect("the host is listening");
        stream
            .set_read_timeout(Some(TIMEOUT))
            .expect("a read deadline can be set on the test socket");
        stream
    }

    fn wire(envelope: &Value) -> Vec<u8> {
        let mut framed = serde_json::to_vec(envelope).expect("an envelope is JSON");
        framed.extend_from_slice(b"\r\n");
        framed
    }

    fn send(stream: &mut TcpStream, bytes: &[u8]) {
        stream
            .write_all(bytes)
            .expect("the host is still reading this connection");
    }

    fn read_reply(stream: &mut TcpStream) -> Value {
        let mut received = Vec::new();
        while !received.ends_with(b"\r\n") {
            let mut byte = [0_u8; 1];
            match stream.read(&mut byte) {
                Ok(0) => panic!(
                    "the connection closed after {} bytes, before a whole reply",
                    received.len()
                ),
                Ok(_) => received.push(byte[0]),
                Err(error) => panic!("no reply arrived: {error}"),
            }
        }
        serde_json::from_slice(&received[..received.len() - 2]).expect("the reply is JSON")
    }

    #[test]
    fn a_database_url_enables_precaching_without_connecting_at_startup() {
        let sandbox = Sandbox::new();
        let settings = settings(&sandbox, Some("not-a-database-url"));
        let worker = build_worker(&settings).expect("a cache can open before connecting");
        let method = Worker::methods()
            .into_iter()
            .find(|method| method.name == "precache_files")
            .expect("the precache method is served");

        let refusal = (method.handler)(&json!({"contest_id": 7}), &worker)
            .expect_err("the call reaches the unusable database URL");

        assert!(refusal.contains("not-a-database-url"), "{refusal}");
    }

    #[test]
    fn echo_replies_and_quit_stops_the_host() {
        let sandbox = Sandbox::new();
        let settings = settings(&sandbox, None);
        let worker = build_worker(&settings).expect("the test cache can be opened");
        assert!(
            settings.shared_file_dir().is_dir(),
            "the worker opens the shared file directory"
        );
        let config = GateConfig {
            secret: Some(SECRET),
            is_backdoor_enabled: false,
        };
        let host = Host::bind("127.0.0.1:0", Worker::methods(), worker, config)
            .expect("an ephemeral port is bindable");
        let addr = host
            .local_addr()
            .expect("a bound listener reports its address");
        service::attach_stop(host.stop_handle()).expect("the test stop slot is usable");
        let (finished, receiver) = mpsc::channel();
        thread::spawn(move || {
            let outcome = host.run();
            finished.send(outcome).expect("the test waits for the host");
        });
        let mut stream = connect(addr);

        send(
            &mut stream,
            &wire(&json!({
                "__id": "echo-1",
                "__secret": SECRET,
                "__method": "echo",
                "__data": {"string": "worker smoke"},
            })),
        );
        let reply = read_reply(&mut stream);
        assert_eq!(reply["__id"], json!("echo-1"));
        assert_eq!(reply["__data"], json!("worker smoke"));
        assert_eq!(reply["__error"], Value::Null);

        send(
            &mut stream,
            &wire(&json!({
                "__id": "quit-1",
                "__secret": SECRET,
                "__method": "quit",
                "__data": {"reason": "smoke test complete", "fatal": false},
            })),
        );
        let quit_reply = read_reply(&mut stream);
        assert_eq!(quit_reply["__id"], json!("quit-1"));
        assert_eq!(quit_reply["__data"], Value::Null);
        assert_eq!(quit_reply["__error"], Value::Null);

        let outcome = receiver
            .recv_timeout(TIMEOUT)
            .expect("quit stops the host without a panic")
            .expect("the host keeps accepting until quit");
        assert_eq!(outcome, RunOutcome::Stopped);
    }
}
