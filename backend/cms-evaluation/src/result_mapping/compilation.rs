//! Mapping a returned compilation into its result and executable rows.

use cms_db::{
    CompilationOutcome, DatasetId, ObjectWrite, OperationType, ResultRow, SubmissionId,
    SubmissionInputs,
};

use super::error::MapError;
use super::rows;
use crate::WorkerOutput;

/// Maps one compilation body, preserving or invalidating the stored result.
pub(super) fn map(
    output: &WorkerOutput,
    inputs: &SubmissionInputs,
    submission_id: SubmissionId,
    dataset_id: DatasetId,
    archive_sandbox: bool,
) -> Result<ObjectWrite, MapError> {
    let prior = inputs.result.as_ref().map(rows::stored);
    let before = prior.clone();
    if output.success {
        success(
            output,
            rows::invalidated(submission_id, dataset_id),
            before,
            submission_id,
            dataset_id,
            archive_sandbox,
        )
    } else {
        Ok(failure(
            prior.unwrap_or_else(|| rows::invalidated(submission_id, dataset_id)),
            before,
            submission_id,
            dataset_id,
            archive_sandbox,
        ))
    }
}

/// Starts from an invalidated row and fills only the compilation columns.
fn success(
    output: &WorkerOutput,
    base: ResultRow,
    before: Option<ResultRow>,
    submission_id: SubmissionId,
    dataset_id: DatasetId,
    archive_sandbox: bool,
) -> Result<ObjectWrite, MapError> {
    let result = compiled_row(output, base);
    let executables = rows::executable_rows(output, submission_id, dataset_id)?;
    let mut audit = Vec::with_capacity(executables.len() + 1);
    audit.push(rows::result_audit(before.as_ref(), &result));
    audit.extend(executables.iter().map(rows::executable_audit));
    Ok(ObjectWrite {
        operation: OperationType::Compilation,
        submission_id,
        dataset_id,
        archive_sandbox,
        result,
        executables,
        evaluations: Vec::new(),
        score: None,
        audit,
    })
}

/// The invalidated row with the body's compilation figures written over it.
fn compiled_row(output: &WorkerOutput, base: ResultRow) -> ResultRow {
    let stats = output.stats.as_ref();
    ResultRow {
        compilation_outcome: output.compilation_success.map(|ok| {
            if ok {
                CompilationOutcome::Ok
            } else {
                CompilationOutcome::Fail
            }
        }),
        compilation_text: output.text.clone().unwrap_or_default(),
        compilation_stdout: stats.and_then(|stats| stats.stdout.clone()),
        compilation_stderr: stats.and_then(|stats| stats.stderr.clone()),
        compilation_time: stats.and_then(|stats| stats.execution_time),
        compilation_wall_clock_time: stats.and_then(|stats| stats.wall_clock_time),
        compilation_memory: stats.and_then(|stats| stats.memory_bytes),
        compilation_sandbox_paths: Some(output.sandboxes.clone()),
        compilation_sandbox_digests: rows::sandbox_digests(output),
        ..base
    }
}

/// A failed compilation adds one try and writes no other row.
fn failure(
    mut result: ResultRow,
    before: Option<ResultRow>,
    submission_id: SubmissionId,
    dataset_id: DatasetId,
    archive_sandbox: bool,
) -> ObjectWrite {
    result.compilation_tries += 1;
    let audit = vec![rows::result_audit(before.as_ref(), &result)];
    ObjectWrite {
        operation: OperationType::Compilation,
        submission_id,
        dataset_id,
        archive_sandbox,
        result,
        executables: Vec::new(),
        evaluations: Vec::new(),
        score: None,
        audit,
    }
}
