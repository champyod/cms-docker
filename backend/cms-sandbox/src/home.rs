//! The run's home: the one directory it may write in, and how far that is narrowed.
//!
//! [`Sandbox::relative_path`] is the one translation between a name inside the box
//! and a path here. [`Sandbox::writable_paths`] decides which names stay inside the
//! home once every symlink is followed; [`Sandbox::allow_writing_only`] closes the
//! home and applies that decision, one chmod per granted path.
//!
//! The test of a name is resolution and never a prefix: `..`, an absolute name and a
//! symlink pointing out all pass a prefix test and all resolve outside the home.
//! [`Sandbox::outer`] is the toplevel of a box, which holds the home and its log.

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
/// The permissions of a path the run may write to: its owner all, group and other
/// write only, because the run is not the owner and must not read back what it
/// writes through the same name.
const MODE_ONLY: u32 = 0o722;

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

    /// Lets the run write only the paths named, and nothing else in its home.
    ///
    /// Each inner path is resolved against the home with every symlink followed; a
    /// path that lands outside it is ignored rather than refused, and a path that
    /// does not exist is created empty so it can be given a permission. The home is
    /// closed before anything is opened, so a path that fails to grant leaves it
    /// closed.
    /// # Errors
    /// [`SpawnError::Io`] when the home could not be closed, read, or one of the
    /// granted paths could not be created or changed; that path stays closed.
    pub fn allow_writing_only(&self, inner_paths: &[&str]) -> Result<(), SpawnError> {
        let granted = self.writable_paths(inner_paths);
        self.allow_writing_none()?;
        granted.into_iter().try_for_each(|path| open(&path))
    }

    /// The host paths among `inner_paths` that lie inside the home once resolved.
    ///
    /// This is the decision [`Sandbox::allow_writing_only`] applies, taken without
    /// changing anything, so a refusal can be read without a second user to meet it.
    #[must_use]
    pub fn writable_paths(&self, inner_paths: &[&str]) -> Vec<PathBuf> {
        let Ok(home) = fs::canonicalize(self.home()) else {
            return Vec::new();
        };
        inner_paths
            .iter()
            .filter_map(|inner| resolve(&self.relative_path(inner)))
            .filter(|path| path.starts_with(&home))
            .collect()
    }

    /// Gives the home and each of its direct entries `mode`.
    ///
    /// An entry that is a symlink out of the home has nothing changed: `chmod`
    /// follows it, and would change a file the home does not hold.
    fn set_every_entry(&self, mode: u32) -> Result<(), SpawnError> {
        let home = self.home();
        let inside = fs::canonicalize(home).map_err(|source| failed(home, source))?;
        set_mode(home, mode)?;
        for entry in fs::read_dir(home).map_err(|source| failed(home, source))? {
            let entry = entry.map_err(|source| failed(home, source))?;
            if let Some(target) = reachable_from_home(&entry.path(), &inside) {
                set_mode(&target, mode)?;
            }
        }
        Ok(())
    }
}

/// The path `mode` has to be set on for an entry of `home`: the entry itself, or
/// what a symlink names when that is still inside the home.
fn reachable_from_home(path: &Path, home: &Path) -> Option<PathBuf> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() => {
            resolve(path).filter(|target| target.starts_with(home))
        }
        Ok(_) => Some(path.to_path_buf()),
        Err(_) => None,
    }
}

/// Opens one already-resolved path to writes, creating it empty when its name is
/// absent; resolution has already refused a link that names nothing.
fn open(path: &Path) -> Result<(), SpawnError> {
    if fs::symlink_metadata(path).is_err() {
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)
            .map_err(|source| failed(path, source))?;
    }
    set_mode(path, MODE_ONLY)
}

/// The path with every symlink on it followed, including a last component that does
/// not exist yet, resolved only under a parent `canonicalize` can vouch for.
fn resolve(path: &Path) -> Option<PathBuf> {
    fs::canonicalize(path)
        .ok()
        .or_else(|| resolve_last_component(path))
}

/// The last component of a path that does not exist yet, joined to its resolved
/// parent, or nothing when the parent is missing or the component is `..`.
fn resolve_last_component(path: &Path) -> Option<PathBuf> {
    if fs::symlink_metadata(path).is_ok_and(|meta| meta.file_type().is_symlink()) {
        return None;
    }
    let parent = fs::canonicalize(path.parent()?).ok()?;
    Some(parent.join(path.file_name()?))
}

/// The refusal a path the file system would not touch is reported as.
fn failed(path: &Path, source: std::io::Error) -> SpawnError {
    SpawnError::Io {
        path: path.to_path_buf(),
        source,
    }
}
