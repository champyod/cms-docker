//! The directory the two phases talk through, and the named pipe inside it.
//!
//! It is made before either box, because a box is handed it as a directory to make
//! visible and one that is not there cannot be made visible. Its name carries a number,
//! so that two evaluations sharing one temporary directory are still two directories
//! and never the same one.
//!
//! The pipe is made by the program every host has for it, resolved on the path rather
//! than named at a place, since a host is free to keep it anywhere but on its path.
//!
//! # Errors
//!
//! [`TaskError::Stage`], and only that: a directory that could not be made, a pipe
//! the program would not make or refused with, and a path whose permissions could not
//! be set.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::fs;
use std::io;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};

use crate::stage::StageError;
use crate::tasktypes::TaskError;

use super::PIPE_NAME;

const FIFO_DIRECTORY: &str = "cms-two-steps-fifo";
/// How many evaluations this worker has made, which is what tells two pipes apart when
/// two of them share one temporary directory, as the reference's own fresh directory
/// per evaluation does.
static EVALUATIONS: AtomicU64 = AtomicU64::new(0);
const MODE_DIRECTORY: u32 = 0o755;
const MODE_PIPE: u32 = 0o666;
const NAMED_PIPE_PROGRAM: &str = "mkfifo";

/// The pipe's directory and the pipe in it, made before any box, and given the
/// permissions a box writing in either of them needs.
pub(super) fn pipe_dir(temp_dir: &Path) -> Result<PathBuf, TaskError> {
    let number = EVALUATIONS.fetch_add(1, Ordering::Relaxed);
    let outer = temp_dir.join(format!("{FIFO_DIRECTORY}-{number}"));
    let pipe = outer.join(PIPE_NAME);
    fs::create_dir_all(&outer).map_err(|source| at(&outer, &source))?;
    let made = Command::new(NAMED_PIPE_PROGRAM).arg(&pipe).status();
    let status = made.map_err(|source| at(&pipe, &source))?;
    if !status.success() {
        let reason = format!("{NAMED_PIPE_PROGRAM} refused to make {}", pipe.display());
        return Err(TaskError::Stage(StageError::Store { reason }));
    }
    for (path, mode) in [(&outer, MODE_DIRECTORY), (&pipe, MODE_PIPE)] {
        let granted = fs::set_permissions(path, fs::Permissions::from_mode(mode));
        granted.map_err(|source| at(path, &source))?;
    }
    Ok(outer)
}

/// A refusal the file system made, named by the path it was made on.
fn at(path: &Path, source: &io::Error) -> TaskError {
    TaskError::Stage(StageError::io(path, source))
}
