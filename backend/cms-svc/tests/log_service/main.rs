//! The binary's input handling: every variable it cannot invent, it refuses, naming it.
//!
//! Each case runs the process this build produced, with an empty environment, so what is
//! asserted is the refusal an operator would see and not a library call behind it.

use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Output, Stdio};

/// The binary under test, built by cargo for this test target.
const BINARY: &str = env!("CARGO_BIN_EXE_cms-log-service");

const ADDRESS_VARIABLE: &str = "LOG_SERVICE_ADDR";
const SECRET_VARIABLE: &str = "RPC_SECRET";
const LOG_DIR_VARIABLE: &str = "LOG_DIR";

/// A scratch log directory removed when the test ends.
struct Sandbox {
    path: PathBuf,
}

impl Sandbox {
    fn new(label: &str) -> Self {
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
struct Running(Child);

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
        (
            SECRET_VARIABLE,
            "5f2c8d0e1a4b7c9d2e3f4a5b6c7d8e9f".to_owned(),
        ),
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
fn run_with(variables: &[(&'static str, String)]) -> Output {
    let mut command = Command::new(BINARY);
    command.env_clear();
    for (name, value) in variables {
        command.env(*name, value);
    }
    command
        .output()
        .expect("the binary this build produced runs")
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

#[test]
fn a_missing_variable_stops_the_process_and_is_named() {
    let sandbox = Sandbox::new("missing");
    for absent in [ADDRESS_VARIABLE, SECRET_VARIABLE, LOG_DIR_VARIABLE] {
        let output = run_with(&supplied(&sandbox, absent, None));
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(
            !output.status.success(),
            "{absent} unset must not start the service, stdout: {}",
            String::from_utf8_lossy(&output.stdout)
        );
        assert!(
            stderr.contains(absent),
            "the refusal must name {absent}, got: {stderr}"
        );
    }
}

#[test]
fn a_blank_variable_is_refused_like_a_missing_one() {
    let sandbox = Sandbox::new("blank");
    let output = run_with(&supplied(&sandbox, SECRET_VARIABLE, Some("   ")));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(!output.status.success(), "a blank secret must not start it");
    assert!(
        stderr.contains(SECRET_VARIABLE),
        "the refusal must name {SECRET_VARIABLE}, got: {stderr}"
    );
}

#[test]
fn the_service_binds_and_reports_the_address_it_bound() {
    let sandbox = Sandbox::new("bound");
    let mut running = spawn_with(&supplied(&sandbox, ADDRESS_VARIABLE, Some("127.0.0.1:0")));
    let stdout = running.0.stdout.take().expect("stdout is piped");
    let mut reported = String::new();
    BufReader::new(stdout)
        .read_line(&mut reported)
        .expect("the bound address is readable on stdout");
    assert!(
        reported.starts_with("cms-log-service listening on 127.0.0.1:"),
        "the address it bound must be reported, got: {reported:?}"
    );
    assert!(
        !reported.trim_end().ends_with(":0"),
        "the port the kernel picked must be the one reported, got: {reported:?}"
    );
}
