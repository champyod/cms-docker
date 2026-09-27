//! The named pipes a manager and one process talk through, and the directory they
//! are made in.
//!
//! A pair is two pipes and a directory, made once per process and named for that
//! process's index, so two processes never share a pipe or a directory. The names a
//! process is handed are the names it sees inside a box; the pipes themselves are
//! made here under the same basenames, which is the whole of the mapping: one
//! directory made visible inside a box, and the two names agree either side of it.
//!
//! The pipes are made by the program every host has for it, resolved on the path
//! rather than named at a place, since a host is free to keep it anywhere but on
//! its path.
//!
//! # Errors
//!
//! [`TaskError::Stage`], and only that: a directory that could not be made, a pipe
//! the program would not make or refused with, and a path whose permissions could
//! not be set.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::fs;
use std::io;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::sandbox::MappedDirectory;
use crate::stage::StageError;

use super::TaskError;

/// The rule that lets a box write in the directory its pipes are in.
const RULE_READ_WRITE: &str = "rw";
/// The permissions a pipe and the directory holding it are given, which every box
/// writing in a pipe needs of both.
const MODE_PIPE: u32 = 0o666;
const MODE_PIPE_DIRECTORY: u32 = 0o755;
/// The program that makes a named pipe.
const NAMED_PIPE_PROGRAM: &str = "mkfifo";
/// The prefix a pair's own directory is given, apart from a box's, so that the two
/// never name the same directory, and where inside a box the pair is seen.
const PIPE_PREFIX: &str = "cms-pipe-";
const PIPE_MOUNT: &str = "/fifo";
const TO_MANAGER: &str = "u{}_to_m";
const TO_USER: &str = "m_to_u{}";

/// One process's pair of pipes, named on this side and as every box handed them
/// sees them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Pipe {
    /// The directory the two pipes were made in, and the one made visible in a box.
    pub(super) outer: PathBuf,
    /// Where inside a box the pair is seen, which the two names below begin with.
    pub(super) inner: String,
    /// The pipe from the process of that index to the manager.
    pub(super) to_manager: String,
    /// The pipe from the manager to the process of that index.
    pub(super) to_user: String,
}

impl Pipe {
    /// The pair belonging to the process of index `index`, made under `temp_dir`.
    pub(super) fn open(temp_dir: &Path, index: usize) -> Result<Self, TaskError> {
        let inner = format!("{PIPE_MOUNT}{index}");
        let pipe = Self {
            to_manager: format!("{inner}/{}", named(TO_MANAGER, index)),
            to_user: format!("{inner}/{}", named(TO_USER, index)),
            outer: temp_dir.join(format!("{PIPE_PREFIX}{index}")),
            inner,
        };
        pipe.make()?;
        Ok(pipe)
    }

    /// The two pipes, and the permissions a box needs of the directory and of each
    /// pipe to write in them.
    fn make(&self) -> Result<(), TaskError> {
        made(&self.outer)?;
        granted(&self.outer, MODE_PIPE_DIRECTORY)?;
        for end in [&self.to_manager, &self.to_user] {
            let path = self.outer.join(basename(end));
            named_pipe(&path)?;
            granted(&path, MODE_PIPE)?;
        }
        Ok(())
    }

    /// The mapping that makes this pair visible inside a box, under the name every
    /// process handed it is given.
    pub(super) fn mapped(&self) -> MappedDirectory {
        MappedDirectory::at(self.outer.clone(), self.inner.clone()).with_options(RULE_READ_WRITE)
    }
}

/// One end of a pair, named for the index of the process that owns it.
fn named(pattern: &str, index: usize) -> String {
    pattern.replace("{}", &index.to_string())
}

/// The name of one end as it is under the directory its pair was made in, which is
/// the last word of the name a process is handed.
fn basename(name: &str) -> &str {
    name.rsplit('/').next().unwrap_or(name)
}

/// The directory a pair of pipes is made in, which a box has to be able to open the
/// pipes inside it, so the whole directory is made first.
fn made(path: &Path) -> Result<(), TaskError> {
    fs::create_dir_all(path).map_err(|source| TaskError::Stage(StageError::io(path, &source)))
}

/// A named pipe, made by the program every host has for it, resolved on the path.
fn named_pipe(path: &Path) -> Result<(), TaskError> {
    let made = Command::new(NAMED_PIPE_PROGRAM)
        .arg(path)
        .output()
        .map_err(|source| TaskError::Stage(StageError::io(path, &source)))?;
    if made.status.success() {
        return Ok(());
    }
    let said = String::from_utf8_lossy(&made.stderr).trim().to_owned();
    Err(TaskError::Stage(StageError::io(
        path,
        &io::Error::other(said),
    )))
}

/// The permissions a path is given, which every box writing in it needs.
fn granted(path: &Path, mode: u32) -> Result<(), TaskError> {
    fs::set_permissions(path, fs::Permissions::from_mode(mode))
        .map_err(|source| TaskError::Stage(StageError::io(path, &source)))
}

/// Every pair removed, which is done once the boxes that shared them are gone and
/// is skipped where a box is kept: a box left standing has a use for a pipe, and a
/// box removed leaves a directory and two pipes nobody can reach.
pub(super) fn close(pipes: &[Pipe], keep: bool) -> Result<(), TaskError> {
    if keep {
        return Ok(());
    }
    for pipe in pipes {
        let outer = pipe.outer.clone();
        fs::remove_dir_all(&outer)
            .map_err(|source| TaskError::Stage(StageError::io(&outer, &source)))?;
    }
    Ok(())
}
