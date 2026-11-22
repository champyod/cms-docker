//! A directory that removes itself, holding the roots a cache needs.

use std::fs;
use std::path::PathBuf;

/// A scratch root, removed when it goes out of scope.
pub struct Scratch {
    root: PathBuf,
}

impl Scratch {
    /// A fresh root for one test.
    pub fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "cms-db-cache-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("creating the scratch root");
        Self { root }
    }

    /// A path inside the root, whether or not anything is there yet.
    pub fn path(&self, name: &str) -> PathBuf {
        self.root.join(name)
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}
