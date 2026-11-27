//! Pure mapping of one returned worker result into the rows one object writes.
//!
//! A worker body, its operation and the inputs it ran against are enough to
//! decide every row of one submission compilation or evaluation. No connection
//! is opened and no requeue is performed: the result is handed to the writer
//! unchanged, and the caller decides what to do with a refused mapping.
//!
//! The operation is the authority for which object and dataset a body belongs
//! to, and for which testcase an evaluation measured. A body that names another
//! object, or a codename that does not name exactly one of the dataset's
//! testcases, is refused by name rather than filed under a key nobody reads.

mod compilation;
mod error;
mod evaluation;
mod rows;

pub use error::MapError;

use cms_db::{DatasetId, ObjectWrite, SubmissionId, SubmissionInputs};
use cms_proto::{Operation, OperationKind};

use crate::WorkerOutput;

/// Maps one returned worker body into the write its operation calls for.
///
/// A compilation invalidates its predecessor and writes the executables the
/// body produced. An evaluation adds one testcase row on success and only
/// increments a counter on failure, except that a tombstone flag on a body
/// whose result already holds a tombstone executable invalidates the
/// compilation instead.
///
/// # Errors
///
/// Returns [`MapError`] naming the operation field, testcase codename or
/// executable digest that refused the mapping, [`MapError::UnsupportedOperation`]
/// for a user-test operation, or [`MapError::NoWriteRequired`] when a tombstone
/// flag does not match an existing tombstone executable.
pub fn map_result(
    output: &WorkerOutput,
    operation: &Operation,
    inputs: &SubmissionInputs,
) -> Result<ObjectWrite, MapError> {
    check_ids(operation, inputs)?;
    let submission_id = SubmissionId(inputs.submission.record.id.0);
    let dataset_id = DatasetId(inputs.dataset.id.0);
    match operation.kind {
        OperationKind::Compilation => compilation::map(
            output,
            inputs,
            submission_id,
            dataset_id,
            operation.archive_sandbox,
        ),
        OperationKind::Evaluation => {
            let testcase_id = resolve_testcase(operation, inputs)?;
            evaluation::map(
                output,
                inputs,
                submission_id,
                dataset_id,
                testcase_id,
                operation.archive_sandbox,
            )
        }
        other => Err(MapError::UnsupportedOperation { kind: other.name() }),
    }
}

/// Confirms the operation and the inputs describe the same object.
fn check_ids(operation: &Operation, inputs: &SubmissionInputs) -> Result<(), MapError> {
    let submission = i64::from(inputs.submission.record.id.0);
    let dataset = i64::from(inputs.dataset.id.0);
    if operation.object_id != submission {
        return Err(MapError::WrongObjectId {
            operation: operation.object_id,
            inputs: submission,
        });
    }
    if operation.dataset_id != dataset {
        return Err(MapError::WrongDatasetId {
            operation: operation.dataset_id,
            inputs: dataset,
        });
    }
    Ok(())
}

/// Resolves an evaluation's codename against the dataset's testcases.
fn resolve_testcase(operation: &Operation, inputs: &SubmissionInputs) -> Result<i32, MapError> {
    let codename = operation
        .testcase_codename
        .as_deref()
        .ok_or(MapError::TestcaseRequired)?;
    let mut found = inputs
        .testcases
        .iter()
        .filter(|case| case.codename == codename)
        .map(|case| case.id);
    let first = found.next().ok_or_else(|| MapError::MissingTestcase {
        codename: codename.to_string(),
    })?;
    if found.next().is_some() {
        return Err(MapError::DuplicateTestcase {
            codename: codename.to_string(),
        });
    }
    Ok(first)
}
