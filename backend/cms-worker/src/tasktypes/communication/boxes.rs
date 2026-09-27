//! The boxes an evaluation makes, what each is handed, and how each is gone.
//!
//! The manager gets a box of its own and the testcase's input, and each process
//! gets a box of its own named for its index and the executable it runs, so that
//! two processes never share a directory. The boxes are named for what runs in
//! them, which is how a report names them and how a worker telling them apart while
//! looking can.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::path::PathBuf;
use std::sync::Arc;

use crate::job::EvaluationJob;
use crate::stage::{Cache, CacheHandle, FileDigest, StageError};
use crate::tasktypes::{handle, Run, Runtime, TaskError};

use super::{INPUT, MANAGER};

/// The two boxes, each named for what runs in it, a process's own box named for its
/// index too so that two processes never share a directory.
const MANAGER_BOX: &str = "manager_evaluate";
const USER_BOX: &str = "user_evaluate";

/// The one store every box of an evaluation reads, handed out as a box of its own.
///
/// The reference passes its file cacher to every sandbox it creates, and a `Box`
/// cannot be handed to two, so the store is shared behind a handle and each box is
/// handed one. Nothing else changes: a submission is one file however many
/// processes run it.
#[derive(Clone)]
pub(super) struct Shared(Arc<dyn Cache>);

impl Shared {
    /// The store the caller handed over, shared rather than split.
    pub(super) fn of(store: Box<dyn Cache>) -> Self {
        Self(Arc::from(store))
    }

    /// The store as a box of its own, which is what a box is opened with.
    pub(super) fn boxed(&self) -> Box<dyn Cache> {
        Box::new(self.clone())
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

/// The manager's box, with the program it runs and the input it reads handed to it.
pub(super) fn manager_of(
    runtime: &Runtime,
    store: &Shared,
    job: &EvaluationJob,
    manager: &str,
) -> Result<Run, TaskError> {
    let run = runtime.open(MANAGER_BOX, store.boxed())?;
    let program = handle(manager)?;
    let input = handle(&job.input)?;
    let files = run.files();
    files.write_from_storage(MANAGER, &program, true)?;
    files.write_from_storage(INPUT, &input, false)?;
    Ok(run)
}

/// The box of each process, with the executable it runs handed to it.
pub(super) fn users_of(
    runtime: &Runtime,
    count: usize,
    store: &Shared,
    executable: &str,
    digest: &str,
) -> Result<Vec<Run>, TaskError> {
    let program = handle(digest)?;
    let mut runs = Vec::with_capacity(count);
    for index in 0..count {
        let name = format!("{USER_BOX}{index}");
        let run = runtime.open(&name, store.boxed())?;
        run.files().write_from_storage(executable, &program, true)?;
        runs.push(run);
    }
    Ok(runs)
}

/// Every box kept where the job asked for it and removed otherwise, the manager's
/// first, answered with the path the report names each box by.
pub(super) fn close(manager: Run, users: Vec<Run>, keep: bool) -> Result<Vec<PathBuf>, TaskError> {
    let mut sandboxes = Vec::with_capacity(users.len() + 1);
    sandboxes.push(manager.close(keep)?);
    for run in users {
        sandboxes.push(run.close(keep)?);
    }
    Ok(sandboxes)
}
