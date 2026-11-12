//! Resolve a CLI against PATH + EXTRA_BIN, then run it with a hard timeout.
//!
//! Cron does not inherit the login shell's PATH, so EXTRA_BIN is searched and injected.

use std::env;
use std::ffi::OsString;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

/// Where the agent CLIs live when cron's bare PATH cannot see them.
pub fn extra_bin() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(home) = env::var_os("HOME") {
        dirs.push(PathBuf::from(home).join(".local/bin"));
    }
    dirs.push(PathBuf::from("/usr/local/bin"));
    dirs.push(PathBuf::from("/opt/homebrew/bin"));
    dirs
}

pub fn extra_bin_display() -> String {
    extra_bin()
        .iter()
        .map(|dir| dir.display().to_string())
        .collect::<Vec<_>>()
        .join(", ")
}

/// EXTRA_BIN first, then whatever PATH the process did inherit.
pub fn path_value() -> OsString {
    let mut parts = extra_bin();
    if let Some(existing) = env::var_os("PATH") {
        parts.extend(env::split_paths(&existing));
    }
    env::join_paths(parts).unwrap_or_else(|_| OsString::from("/usr/local/bin:/usr/bin:/bin"))
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    fs::metadata(path)
        .map(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable(path: &Path) -> bool {
    path.is_file()
}

/// `shutil.which` plus EXTRA_BIN: a slash means a path, otherwise search both lists.
pub fn resolve(binary: &str) -> Option<PathBuf> {
    if binary.contains('/') {
        let path = PathBuf::from(binary);
        return is_executable(&path).then_some(path);
    }
    let from_env = env::var_os("PATH")
        .map(|value| env::split_paths(&value).collect::<Vec<_>>())
        .unwrap_or_default();
    let extra = extra_bin();
    from_env
        .iter()
        .chain(extra.iter())
        .map(|dir| dir.join(binary))
        .find(|candidate| is_executable(candidate))
}

pub struct Answer {
    pub stdout: String,
    pub stderr: String,
    pub code: i32,
}

fn slurp(mut pipe: impl Read) -> String {
    let mut text = String::new();
    let _ = pipe.read_to_string(&mut text);
    text
}

/// Wait on the child's deadline; the readers keep draining both pipes meanwhile.
fn wait_with_deadline(
    child: &mut std::process::Child,
    deadline: Instant,
) -> Result<std::process::ExitStatus, String> {
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Ok(status),
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("timeout".to_string());
            }
            Ok(None) => thread::sleep(Duration::from_millis(50)),
            Err(error) => {
                let _ = child.kill();
                return Err(format!("wait: {error}"));
            }
        }
    }
}

/// stdout and stderr are drained by threads so a chatty CLI cannot deadlock.
pub fn run(
    binary: &Path,
    argv: &[String],
    timeout: Duration,
    workdir: Option<&Path>,
) -> Result<Answer, String> {
    let mut command = Command::new(binary);
    command
        .args(argv)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("PATH", path_value());
    if let Some(dir) = workdir {
        command.current_dir(dir);
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("spawn {}: {error}", binary.display()))?;
    let out_pipe = child.stdout.take().ok_or("no stdout pipe")?;
    let err_pipe = child.stderr.take().ok_or("no stderr pipe")?;
    let out_reader = thread::spawn(move || slurp(out_pipe));
    let err_reader = thread::spawn(move || slurp(err_pipe));
    let status = wait_with_deadline(&mut child, Instant::now() + timeout)?;
    Ok(Answer {
        stdout: out_reader.join().unwrap_or_default(),
        stderr: err_reader.join().unwrap_or_default(),
        code: status.code().unwrap_or(-1),
    })
}
