//! The box of one phase, and what that box is handed.
//!
//! The two phases never share a box: each is opened under the name of the step its
//! manager is told it is, which is how a report names them. The manager itself is
//! handed to both, and the testcase's input to the first phase only, under the name
//! that phase reads it from — the second recovers what the first computed and so is
//! given nothing to read.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use crate::tasktypes::{handle, Run, Runtime, TaskError};

use super::{Phase, Shared};

/// The box of one phase, handed the manager it runs and, where that phase reads one,
/// the testcase's input under the name it is read from.
pub(super) fn open_phase(
    runtime: &Runtime,
    store: &Shared,
    phase: &Phase,
    executable: &str,
    digest: &str,
    input: &str,
) -> Result<Run, TaskError> {
    let run = runtime.open(phase.name, Box::new(store.clone()))?;
    run.files()
        .write_from_storage(executable, &handle(digest)?, true)?;
    if let Some(name) = phase.input {
        run.files()
            .write_from_storage(name, &handle(input)?, false)?;
    }
    Ok(run)
}
