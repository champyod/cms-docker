//! The checker binary as a process: named startup refusals and its real RPC host.

mod serving;
mod startup;

use std::io::{BufRead, BufReader, ErrorKind, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::process::{Child, Command, ExitStatus, Output, Stdio};
use std::sync::mpsc::channel;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use cms_proto::{encode, Framer, Request};
use serde_json::{json, Value};

/// The binary under test, built by cargo for this test target.
const BINARY: &str = env!("CARGO_BIN_EXE_cms-checker");

/// How long a process that should finish or start is given before it is killed.
const DEADLINE: Duration = Duration::from_secs(5);

/// How often the watchdog checks whether the process has exited.
const POLL_INTERVAL: Duration = Duration::from_millis(25);

/// How long a client waits before calling the service unresponsive.
const REPLY_TIMEOUT: Duration = Duration::from_secs(5);

/// The line printed once the listener is bound.
const LISTENING: &str = "cms-checker listening on ";

/// The secret every authenticated invocation here is configured with.
const SECRET: &str = "5f2c8d0e1a4b7c9d2e3f4a5b6c7d8e9f";

const PORT_VARIABLE: &str = "CHECKER_SERVICE_PORT";
const SHARD_VARIABLE: &str = "CHECKER_SERVICE_SHARD";
const SECRET_VARIABLE: &str = "RPC_SECRET";
const SERVICES_VARIABLE: &str = "CMS_SERVICES";

/// A complete invocation; the table points at a port that has just been released.
fn complete() -> Vec<(&'static str, String)> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("a port can be reserved");
    let addr = listener
        .local_addr()
        .expect("the reserved port has an address");
    drop(listener);
    vec![
        (PORT_VARIABLE, "0".to_owned()),
        (SHARD_VARIABLE, "0".to_owned()),
        (SECRET_VARIABLE, SECRET.to_owned()),
        (
            SERVICES_VARIABLE,
            format!("Peer|0|{}|{}\n", addr.ip(), addr.port()),
        ),
    ]
}

/// The complete set with one variable omitted or replaced.
fn supplied(changed: &'static str, replacement: Option<&str>) -> Vec<(&'static str, String)> {
    let mut variables = complete();
    match replacement {
        Some(value) => match variables.iter_mut().find(|(name, _)| *name == changed) {
            Some((_, current)) => *current = value.to_owned(),
            None => variables.push((changed, value.to_owned())),
        },
        None => variables.retain(|(name, _)| *name != changed),
    }
    variables
}

/// Runs the binary to completion with exactly these variables and nothing inherited.
fn run_with(variables: &[(&'static str, String)]) -> Output {
    let mut command = Command::new(BINARY);
    command
        .env_clear()
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (name, value) in variables {
        command.env(name, value);
    }
    let mut child = command.spawn().expect("the built binary runs");
    wait_with_deadline(&mut child);
    child
        .wait_with_output()
        .expect("finished output is readable")
}

/// Starts the binary with exactly these variables and nothing inherited.
fn spawn_with(variables: &[(&'static str, String)]) -> Running {
    let mut command = Command::new(BINARY);
    command
        .env_clear()
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (name, value) in variables {
        command.env(name, value);
    }
    Running {
        child: command.spawn().expect("the built binary runs"),
        reader: None,
    }
}

/// A child killed when the test ends, so a failed assertion leaves no listener behind.
struct Running {
    child: Child,
    reader: Option<JoinHandle<()>>,
}

impl Running {
    /// Reads the bound address with a deadline, so a startup refusal fails instead of hanging.
    fn started(&mut self) -> SocketAddr {
        let stdout = self.child.stdout.take().expect("stdout is piped");
        let (sender, receiver) = channel();
        self.reader = Some(thread::spawn(move || {
            let mut reported = String::new();
            BufReader::new(stdout)
                .read_line(&mut reported)
                .expect("the bound address is readable");
            let _ = sender.send(reported);
        }));
        let reported = receiver
            .recv_timeout(DEADLINE)
            .expect("the binary reports its bound address before the deadline");
        let address = reported
            .trim_end()
            .strip_prefix(LISTENING)
            .unwrap_or_else(|| panic!("the service must report its address, got: {reported:?}"));
        address
            .parse()
            .expect("the reported address is a socket address")
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        if let Some(reader) = self.reader.take() {
            let _ = reader.join();
        }
    }
}

/// Waits for the process, killing it at the deadline so a regression fails instead of hanging.
fn wait_with_deadline(child: &mut Child) -> ExitStatus {
    let started = Instant::now();
    loop {
        match child.try_wait().expect("the binary can be polled") {
            Some(status) => return status,
            None if started.elapsed() > DEADLINE => {
                child.kill().expect("an overdue binary can be killed");
                return child.wait().expect("a killed binary can be reaped");
            }
            None => thread::sleep(POLL_INTERVAL),
        }
    }
}

/// Waits for the process to exit and returns its status with everything it wrote to stderr.
fn finish(mut running: Running) -> (ExitStatus, String) {
    let status = wait_with_deadline(&mut running.child);
    let mut stderr = String::new();
    if let Some(mut pipe) = running.child.stderr.take() {
        pipe.read_to_string(&mut stderr)
            .expect("the stderr of an exited process is readable");
    }
    (status, stderr)
}

/// Connects to the service with a deadline on every read.
fn connect(addr: SocketAddr) -> TcpStream {
    let stream = TcpStream::connect(addr).expect("the service is listening");
    stream
        .set_read_timeout(Some(REPLY_TIMEOUT))
        .expect("a read deadline can be set on the test socket");
    stream
}

/// Sends one authenticated call and reads the one reply it is owed.
fn call(stream: &mut TcpStream, id: &str, method: &str, data: Value) -> Value {
    let request = Request {
        id: id.to_owned(),
        method: method.to_owned(),
        data,
        secret: Some(SECRET.to_owned()),
    };
    let framed = encode(&request).expect("the request fits the size limit");
    stream
        .write_all(&framed)
        .expect("the service reads this connection");
    let mut framer = Framer::default();
    let mut chunk = [0_u8; 8 * 1024];
    loop {
        if let Some(frame) = framer.next_frame().expect("the reply is a legal frame") {
            return frame.value;
        }
        match stream.read(&mut chunk) {
            Ok(0) => panic!("the connection closed before a whole reply"),
            Ok(read) => framer
                .push(&chunk[..read])
                .expect("the reply fits the size limit"),
            Err(error) if error.kind() == ErrorKind::Interrupted => continue,
            Err(error) => panic!("no reply arrived: {error}"),
        }
    }
}

/// The JSON data a successful echo call returns.
pub(crate) fn echo(stream: &mut TcpStream, text: &str) -> Value {
    call(stream, "echo", "echo", json!({"string": text}))["__data"].clone()
}
