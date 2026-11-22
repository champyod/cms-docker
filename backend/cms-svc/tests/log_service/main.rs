//! The logger binary as a process: what it refuses at startup, and what `quit` asks of it.

mod quit;
mod startup;

use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, ExitStatus, Output, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

/// The binary under test, built by cargo for this test target.
const BINARY: &str = env!("CARGO_BIN_EXE_cms-log-service");

/// How long a process that should finish, start or stop, is given before it is killed.
const DEADLINE: Duration = Duration::from_secs(5);

/// How often the watchdog checks whether the process has exited.
const POLL_INTERVAL: Duration = Duration::from_millis(25);

/// How long a client waits before it calls the service unresponsive.
const REPLY_TIMEOUT: Duration = Duration::from_secs(5);

/// The line the binary prints once it is serving, with the address it bound after it.
const LISTENING: &str = "cms-log-service listening on ";

/// The secret every invocation here is configured with.
const SECRET: &str = "5f2c8d0e1a4b7c9d2e3f4a5b6c7d8e9f";

const ADDRESS_VARIABLE: &str = "LOG_SERVICE_ADDR";
const SECRET_VARIABLE: &str = "RPC_SECRET";
const LOG_DIR_VARIABLE: &str = "LOG_DIR";

/// A scratch log directory removed when the test ends.
pub(crate) struct Sandbox {
    path: PathBuf,
}

impl Sandbox {
    pub(crate) fn new(label: &str) -> Self {
        let path =
            std::env::temp_dir().join(format!("cms-log-service-{}-{label}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        Self { path }
    }
}

impl Drop for Sandbox {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

/// A child killed when the test ends, so a failed assertion leaves no listener behind.
pub(crate) struct Running(Child);

impl Drop for Running {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

/// The variables a complete invocation needs; the address asks the kernel for a port.
fn complete(sandbox: &Sandbox) -> Vec<(&'static str, String)> {
    vec![
        (ADDRESS_VARIABLE, "127.0.0.1:0".to_owned()),
        (SECRET_VARIABLE, SECRET.to_owned()),
        (
            LOG_DIR_VARIABLE,
            sandbox.path.to_string_lossy().into_owned(),
        ),
    ]
}

/// The complete set with one variable left out, or one replaced by `replacement`.
fn supplied(
    sandbox: &Sandbox,
    changed: &str,
    replacement: Option<&str>,
) -> Vec<(&'static str, String)> {
    let mut variables = complete(sandbox);
    match replacement {
        Some(value) => {
            for (name, current) in variables.iter_mut() {
                if *name == changed {
                    *current = value.to_owned();
                }
            }
        }
        None => variables.retain(|(name, _)| *name != changed),
    }
    variables
}

/// Runs the binary to completion with exactly these variables and nothing inherited.
pub(crate) fn run_with(variables: &[(&'static str, String)]) -> Output {
    let mut command = Command::new(BINARY);
    command.env_clear();
    for (name, value) in variables {
        command.env(*name, value);
    }
    let child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("the binary this build produced runs");
    let mut child = child;
    wait_with_deadline(&mut child);
    child
        .wait_with_output()
        .expect("the output of a finished binary can be read")
}

/// Starts the binary with exactly these variables and nothing inherited.
fn spawn_with(variables: &[(&'static str, String)]) -> Running {
    let mut command = Command::new(BINARY);
    command
        .env_clear()
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (name, value) in variables {
        command.env(*name, value);
    }
    Running(
        command
            .spawn()
            .expect("the binary this build produced runs"),
    )
}

/// Waits for the process, killing it at the deadline so a regression fails instead of hanging the suite.
fn wait_with_deadline(child: &mut Child) -> ExitStatus {
    let started = Instant::now();
    loop {
        match child.try_wait().expect("the binary can be polled") {
            Some(status) => return status,
            None if started.elapsed() > DEADLINE => {
                child
                    .kill()
                    .expect("a binary that outlived its deadline can be killed");
                return child.wait().expect("a killed binary can be reaped");
            }
            None => thread::sleep(POLL_INTERVAL),
        }
    }
}

/// Starts the binary on an ephemeral port and reads the address it reports, so a test talks to a real listener.
pub(crate) fn started(sandbox: &Sandbox) -> (Running, SocketAddr) {
    let mut running = spawn_with(&supplied(sandbox, ADDRESS_VARIABLE, Some("127.0.0.1:0")));
    let stdout = running.0.stdout.take().expect("stdout is piped");
    let mut reported = String::new();
    BufReader::new(stdout)
        .read_line(&mut reported)
        .expect("the bound address is readable on stdout");
    let address = reported
        .trim_end()
        .strip_prefix(LISTENING)
        .unwrap_or_else(|| panic!("the service must report its address, got: {reported:?}"));
    let addr = address
        .parse()
        .expect("the reported address is a socket address");
    (running, addr)
}

/// Waits for the process to exit and returns its status with everything it wrote to stderr.
pub(crate) fn finish(mut running: Running) -> (ExitStatus, String) {
    let status = wait_with_deadline(&mut running.0);
    let mut stderr = String::new();
    if let Some(mut pipe) = running.0.stderr.take() {
        pipe.read_to_string(&mut stderr)
            .expect("the stderr of an exited process is readable");
    }
    (status, stderr)
}

/// Connects to the service with a deadline on every read, so a missing reply fails instead of hanging.
pub(crate) fn connect(addr: SocketAddr) -> TcpStream {
    let stream = TcpStream::connect(addr).expect("the service is listening");
    stream
        .set_read_timeout(Some(REPLY_TIMEOUT))
        .expect("a read deadline can be set on the test socket");
    stream
}

/// Sends one call and reads the one reply it is owed.
pub(crate) fn call(stream: &mut TcpStream, id: &str, method: &str, data: Value) -> Value {
    let envelope = json!({
        "__id": id,
        "__method": method,
        "__data": data,
        "__secret": SECRET,
    });
    let mut framed = serde_json::to_vec(&envelope).expect("an envelope is JSON");
    framed.extend_from_slice(b"\r\n");
    stream
        .write_all(&framed)
        .expect("the service reads this connection");
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
