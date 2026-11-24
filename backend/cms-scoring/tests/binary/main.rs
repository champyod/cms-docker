//! The scoring binary as a process: named startup refusals and its real RPC host.

mod serving;
mod startup;

#[path = "../support/service_db.rs"]
mod service_db;
#[path = "../support/service_schema.rs"]
mod service_schema;

use std::io::{BufRead, BufReader, Read};
use std::net::SocketAddr;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::mpsc::channel;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

/// The binary under test, built by cargo for this test target.
pub(crate) const BINARY: &str = env!("CARGO_BIN_EXE_cms-scoring");

/// How long a process that should finish or start is given before it is killed.
pub(crate) const DEADLINE: Duration = Duration::from_secs(5);

/// How often the watchdog checks whether the process has exited.
const POLL_INTERVAL: Duration = Duration::from_millis(25);

/// The line printed once the listener is bound.
pub(crate) const LISTENING: &str = "cms-scoring listening on ";

/// The secret every authenticated invocation here is configured with.
pub(crate) const SECRET: &str = "5f2c8d0e1a4b7c9d2e3f4a5b6c7d8e9f";

pub(crate) const PORT_VARIABLE: &str = "SCORING_SERVICE_PORT";
pub(crate) const SHARD_VARIABLE: &str = "SCORING_SERVICE_SHARD";
pub(crate) const SECRET_VARIABLE: &str = "RPC_SECRET";
pub(crate) const DATABASE_URL_VARIABLE: &str = "DATABASE_URL";

/// Runs the binary to completion with exactly these variables and nothing inherited.
pub(crate) fn run_with(variables: &[(&'static str, String)]) -> Finished {
    finish(spawn_with(variables))
}

/// Starts the binary with exactly these variables and nothing inherited.
pub(crate) fn spawn_with(variables: &[(&'static str, String)]) -> Running {
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
pub(crate) struct Running {
    child: Child,
    reader: Option<JoinHandle<()>>,
}

impl Running {
    /// Reads the bound address with a deadline, so a startup refusal fails instead of hanging.
    pub(crate) fn started(&mut self) -> SocketAddr {
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
                return child.wait().expect("a killed binary is reaped");
            }
            None => thread::sleep(POLL_INTERVAL),
        }
    }
}

/// Everything a finished process wrote, with the status the watchdog observed.
#[derive(Debug)]
pub(crate) struct Finished {
    pub(crate) status: ExitStatus,
    pub(crate) stdout: Vec<u8>,
    pub(crate) stderr: Vec<u8>,
}

/// Waits for the process to exit and returns its status with everything it wrote.
pub(crate) fn finish(mut running: Running) -> Finished {
    let status = wait_with_deadline(&mut running.child);
    let mut stdout = Vec::new();
    if let Some(mut pipe) = running.child.stdout.take() {
        pipe.read_to_end(&mut stdout)
            .expect("finished stdout is readable");
    }
    let mut stderr = Vec::new();
    if let Some(mut pipe) = running.child.stderr.take() {
        pipe.read_to_end(&mut stderr)
            .expect("finished stderr is readable");
    }
    Finished {
        status,
        stdout,
        stderr,
    }
}
