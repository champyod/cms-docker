#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::sync::Arc;

use crate::job::EvaluationJob;
use crate::stage::{Cache, CacheHandle, FileDigest, StageError};
use crate::tasktypes::{handle, Closed, Run, Runtime, TaskError};

use super::{INPUT, MANAGER};

const MANAGER_BOX: &str = "manager_evaluate";
const USER_BOX: &str = "user_evaluate";

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

pub(super) fn close(
    manager: Run,
    users: Vec<Run>,
    keep: bool,
    archive: bool,
) -> Result<Vec<Closed>, TaskError> {
    let mut closed = Vec::with_capacity(users.len() + 1);
    closed.push(manager.close(keep, archive)?);
    for run in users {
        closed.push(run.close(keep, archive)?);
    }
    Ok(closed)
}
