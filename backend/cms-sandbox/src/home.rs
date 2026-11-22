//! The run's home: the one directory it may write in, named from this side.
//!
//! A run is bound to its home and sees it at one fixed path inside the box, and
//! every path a caller names for that run is an inner path — a name inside the box
//! — which this side has to turn back into a path here. There is one translation
//! and it is [`Sandbox::relative_path`]: the box's home on this side is the box's
//! home inside it, so a name inside the box is that same name under this directory.
//!
//! The toplevel of a box, which holds the home and the log a run writes, is
//! [`Sandbox::outer`]; it is what archiving or deleting a whole box works on, and
//! it is not a path a run ever sees.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::fs;
use std::path::{Path, PathBuf};

use super::spawn::set_mode;
use super::{Sandbox, SpawnError};

/// The permissions of a home and its entries when the run may write anything.
const MODE_ALL: u32 = 0o777;
/// The permissions they are given when it may write nothing: its owner reads and
/// traverses, and the run, which does not own its home, only reads and traverses.
const MODE_NONE: u32 = 0o755;

impl Sandbox {
    /// The path on this side of a file the run sees at `path`.
    ///
    /// An absolute `path` replaces the home rather than joining it, which is how
    /// the box itself resolves one: it is the caller's to check that such a path is
    /// still inside the home, and the writing rules do.
    #[must_use]
    pub fn relative_path(&self, path: impl AsRef<Path>) -> PathBuf {
        self.home().join(path)
    }

    /// Opens the home, and each of its direct entries, to writes by anyone.
    ///
    /// A directory below the top level keeps the permissions it had.
    /// # Errors
    /// [`SpawnError::Io`] when the home or an entry could not be changed.
    pub fn allow_writing_all(&self) -> Result<(), SpawnError> {
        self.set_every_entry(MODE_ALL)
    }

    /// Closes the home, and each of its direct entries, to writes by anyone but
    /// their owner, which is not the run.
    ///
    /// A directory below the top level keeps the permissions it had.
    /// # Errors
    /// [`SpawnError::Io`] when the home or an entry could not be changed.
    pub fn allow_writing_none(&self) -> Result<(), SpawnError> {
        self.set_every_entry(MODE_NONE)
    }

    /// Gives the home and each of its direct entries `mode`.
    fn set_every_entry(&self, mode: u32) -> Result<(), SpawnError> {
        let home = self.home();
        set_mode(home, mode)?;
        for entry in fs::read_dir(home).map_err(|source| failed(home, source))? {
            let entry = entry.map_err(|source| failed(home, source))?;
            set_mode(&entry.path(), mode)?;
        }
        Ok(())
    }
}

/// The refusal a path the file system would not touch is reported as.
fn failed(path: &Path, source: std::io::Error) -> SpawnError {
    SpawnError::Io {
        path: path.to_path_buf(),
        source,
    }
}
