//! Unique names for the temporary files and directories a backend and a cache make.
//!
//! `tempfile.mkstemp` and `mkdtemp` are not in `std`, and a random name is not
//! needed to make one unique: the process id and a counter cannot repeat inside a
//! run, and `create_new` refuses a name a previous run left behind, so the loop
//! simply moves on. Names are also predictable here, which is what lets a test say
//! where a temporary file went.

use std::fs::{self, File, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

/// The counter that tells two names in one process apart.
static NEXT: AtomicU64 = AtomicU64::new(0);

/// Create a new file named `prefix<pid>.<count><suffix>` in `directory`.
///
/// # Errors
///
/// The `std::io::Error` of the last attempt, which is the first failure that was
/// not a name already taken.
pub(crate) fn create_file(
    directory: &Path,
    prefix: &str,
    suffix: &str,
) -> io::Result<(File, PathBuf)> {
    loop {
        let path = directory.join(candidate(prefix, suffix));
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => return Ok((file, path)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
}

/// Create a new directory named `prefix<pid>.<count>` in `directory`.
///
/// # Errors
///
/// The `std::io::Error` of the last attempt, as [`create_file`] reports it.
pub(crate) fn create_directory(directory: &Path, prefix: &str) -> io::Result<PathBuf> {
    loop {
        let path = directory.join(candidate(prefix, ""));
        match fs::create_dir(&path) {
            Ok(()) => return Ok(path),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
}

fn candidate(prefix: &str, suffix: &str) -> String {
    let count = NEXT.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}{}.{count}{suffix}", std::process::id())
}
