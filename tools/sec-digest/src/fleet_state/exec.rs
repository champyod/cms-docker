//! Shelling out the way the Python `_run` does: text back, and failure as text.
//!
//! Nothing here builds a shell string: argv is passed as-is, so a repo path or a
//! host name can never be re-split or expanded. A child that outlives its deadline
//! is killed and reported, never waited on forever.

use std::io::Read;
use std::path::Path;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::thread;
use std::time::{Duration, Instant};

/// The one seam the collector needs faked in tests: argv, cwd, deadline in, text out.
pub trait Runner {
    fn run(&self, argv: &[String], cwd: Option<&Path>, timeout: Duration) -> String;
}

/// Real processes. `SystemRunner` is the only implementation that touches the box.
pub struct SystemRunner;

enum Wait {
    Done(ExitStatus),
    TimedOut,
    Broken(String),
}

impl Runner for SystemRunner {
    fn run(&self, argv: &[String], cwd: Option<&Path>, timeout: Duration) -> String {
        let Some(program) = argv.first() else {
            return "__error__ ValueError: empty command".to_string();
        };
        let mut command = Command::new(program);
        command.args(&argv[1..]).stdin(Stdio::null());
        command.stdout(Stdio::piped()).stderr(Stdio::piped());
        if let Some(dir) = cwd {
            command.current_dir(dir);
        }
        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => return spawn_error(program, &error),
        };
        let out = child.stdout.take().map(capture);
        let err = child.stderr.take().map(capture);
        let wait = wait_with_deadline(&mut child, timeout);
        if !matches!(wait, Wait::Done(_)) {
            let _ = child.kill();
            let _ = child.wait();
        }
        let stdout = join(out);
        let stderr = join(err);
        finish(program, timeout, wait, stdout, stderr)
    }
}

/// Python's `_run` contract: stdout, plus stderr when the child failed.
fn finish(program: &str, timeout: Duration, wait: Wait, stdout: String, stderr: String) -> String {
    match wait {
        Wait::Done(status) if status.success() => stdout,
        Wait::Done(_) => format!("{stdout}\n{stderr}"),
        Wait::TimedOut => format!(
            "__error__ TimeoutExpired: {program} timed out after {}s",
            timeout.as_secs_f64()
        ),
        Wait::Broken(reason) => format!("__error__ OSError: {program}: {reason}"),
    }
}

/// Read a pipe on its own thread, so a chatty child cannot fill it and deadlock.
fn capture<R: Read + Send + 'static>(mut pipe: R) -> thread::JoinHandle<String> {
    thread::spawn(move || {
        let mut text = String::new();
        let _ = pipe.read_to_string(&mut text);
        text
    })
}

fn join(handle: Option<thread::JoinHandle<String>>) -> String {
    handle
        .and_then(|reader| reader.join().ok())
        .unwrap_or_default()
}

/// Poll until the child exits or the hard deadline passes; no unbounded wait.
fn wait_with_deadline(child: &mut Child, timeout: Duration) -> Wait {
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Wait::Done(status),
            Ok(None) => {}
            Err(error) => return Wait::Broken(error.to_string()),
        }
        if Instant::now() >= deadline {
            return Wait::TimedOut;
        }
        thread::sleep(Duration::from_millis(20));
    }
}

fn spawn_error(program: &str, error: &std::io::Error) -> String {
    let kind = match error.kind() {
        std::io::ErrorKind::NotFound => "FileNotFoundError",
        std::io::ErrorKind::PermissionDenied => "PermissionError",
        _ => "OSError",
    };
    format!("__error__ {kind}: {program}: {error}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn argv(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|part| (*part).to_string()).collect()
    }

    #[test]
    fn stdout_comes_back_untouched() {
        let text = SystemRunner.run(&argv(&["echo", "kernel=6.1"]), None, Duration::from_secs(5));
        assert_eq!(text, "kernel=6.1\n");
    }

    #[test]
    fn a_failing_child_keeps_its_stderr() {
        let text = SystemRunner.run(
            &argv(&["ls", "/definitely-not-here"]),
            None,
            Duration::from_secs(5),
        );
        assert!(text.contains("No such file"), "{text}");
        assert!(!text.contains("__error__"));
    }

    #[test]
    fn a_missing_program_is_reported_named() {
        let text = SystemRunner.run(&argv(&["gh-not-installed"]), None, Duration::from_secs(5));
        assert!(
            text.starts_with("__error__ FileNotFoundError: gh-not-installed"),
            "{text}"
        );
    }

    #[test]
    fn a_child_past_its_deadline_is_killed_and_named() {
        let text = SystemRunner.run(&argv(&["sleep", "5"]), None, Duration::from_millis(150));
        assert_eq!(
            text,
            "__error__ TimeoutExpired: sleep timed out after 0.15s"
        );
    }
}
