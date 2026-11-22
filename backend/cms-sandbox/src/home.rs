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

use std::path::{Path, PathBuf};

use super::Sandbox;

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
}
