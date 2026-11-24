#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::stage::{Cache, CacheHandle, FileDigest, Stage, StageError};
use crate::steps::TrustedLimits;
use cms_proto::DigestMap;
use cms_sandbox::ExecutionStats;
use cms_sandbox::{Launch, Options, Sandbox};

use super::{CompilationLimits, TaskError};

#[derive(Debug, Clone, PartialEq, Eq)]
/// Keeps machine settings out of task types so each phase can be exercised with a stub.
pub struct Runtime {
    program: PathBuf,
    temp_dir: PathBuf,
    /// The three numbers a compilation is held to.
    pub compilation: CompilationLimits,
    /// Bounds every evaluation box without charging the limit to a testcase score.
    pub file_size: Option<u64>,
    /// Bounds dataset checkers independently of submission resource limits.
    pub trusted: TrustedLimits,
}

impl Runtime {
    pub(super) fn temp_dir(&self) -> &Path {
        &self.temp_dir
    }

    #[must_use]
    /// Takes every machine setting by value so no phase reads global configuration.
    pub fn new(
        program: impl Into<PathBuf>,
        temp_dir: impl Into<PathBuf>,
        compilation: CompilationLimits,
        file_size: Option<u64>,
        trusted: TrustedLimits,
    ) -> Self {
        Self {
            program: program.into(),
            temp_dir: temp_dir.into(),
            compilation,
            file_size,
            trusted,
        }
    }

    pub(super) fn open(&self, name: &str, store: Box<dyn Cache>) -> Result<Run, TaskError> {
        self.open_shared(name, Arc::from(store))
    }

    pub(super) fn open_shared(&self, name: &str, store: Arc<dyn Cache>) -> Result<Run, TaskError> {
        let sandbox =
            Sandbox::new(&self.program, &self.temp_dir, name).map_err(TaskError::Spawn)?;
        let files = Stage::at(sandbox.home(), Box::new(Shared(store))).map_err(TaskError::Stage)?;
        Ok(Run { sandbox, files })
    }
}

#[derive(Clone)]
pub(crate) struct Shared(Arc<dyn Cache>);

impl Shared {
    /// The store the caller handed over, shared rather than split.
    pub(super) fn of(store: impl Into<Arc<dyn Cache>>) -> Self {
        Self(store.into())
    }

    /// The store as a handle, which is what a box opened over it is given.
    pub(super) fn arc(&self) -> Arc<dyn Cache> {
        Arc::clone(&self.0)
    }
}

impl Cache for Shared {
    fn get_file(&self, handle: &CacheHandle) -> Result<Vec<u8>, StageError> {
        self.0.get_file(handle)
    }

    fn put_file(&self, digest: &FileDigest, content: &[u8]) -> Result<bool, StageError> {
        self.0.put_file(digest, content)
    }
}

pub(crate) struct Run {
    sandbox: Sandbox,
    files: Stage,
}

/// A closed box's path and the digest its archive was filed under, when asked for.
pub(crate) struct Closed {
    root: PathBuf,
    digest: Option<FileDigest>,
}

impl Closed {
    /// Records the box after those closed before it.
    pub(super) fn record(self, sandboxes: &mut Vec<PathBuf>, sandbox_digests: &mut DigestMap) {
        let index = sandboxes.len();
        self.record_at(index, sandboxes, sandbox_digests);
    }

    /// Records the box before those a later phase closed.
    pub(super) fn record_first(
        self,
        sandboxes: &mut Vec<PathBuf>,
        sandbox_digests: &mut DigestMap,
    ) {
        self.record_at(0, sandboxes, sandbox_digests);
    }

    fn record_at(
        self,
        index: usize,
        sandboxes: &mut Vec<PathBuf>,
        sandbox_digests: &mut DigestMap,
    ) {
        if let Some(digest) = &self.digest {
            sandbox_digests.insert(sandbox_path(&self.root), digest.as_str().to_owned());
        }
        sandboxes.insert(index, self.root);
    }
}

/// The string a sandbox path is keyed by in a result and on the wire.
pub(crate) fn sandbox_path(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

impl Run {
    pub(super) fn sandbox(&mut self) -> &mut Sandbox {
        &mut self.sandbox
    }

    pub(super) fn parts(&mut self) -> (&mut Sandbox, &Stage) {
        (&mut self.sandbox, &self.files)
    }

    pub(super) fn files(&self) -> &Stage {
        &self.files
    }

    pub(super) fn started(
        &mut self,
        words: &[&str],
        options: &Options,
    ) -> Result<Launch, TaskError> {
        self.sandbox.set_options(options.clone());
        self.sandbox.start(words).map_err(TaskError::Spawn)
    }

    /// Launches one command under `options` and answers with what it was charged.
    pub(super) fn launch(
        &mut self,
        command: &[String],
        options: &Options,
    ) -> Result<ExecutionStats, TaskError> {
        self.sandbox.set_options(options.clone());
        let words: Vec<&str> = command.iter().map(String::as_str).collect();
        self.sandbox.run(&words).map_err(TaskError::Spawn)
    }

    /// Archives first so a refusal cannot destroy the box it was meant to preserve.
    pub(super) fn close(self, keep: bool, archive: bool) -> Result<Closed, TaskError> {
        let root = self.sandbox.outer().to_path_buf();
        let digest = if archive {
            Some(
                self.files
                    .archive(&self.sandbox)
                    .map_err(TaskError::Archive)?,
            )
        } else {
            None
        };
        if !keep {
            if let Err(source) = fs::remove_dir_all(&root) {
                return Err(TaskError::Stage(StageError::io(&root, &source)));
            }
        }
        Ok(Closed { root, digest })
    }
}
