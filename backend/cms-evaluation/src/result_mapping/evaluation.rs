//! Mapping a returned evaluation into a testcase row, a retry or an invalidation.

use cms_db::{
    DatasetId, EvaluationRow, FileDigest, ObjectWrite, OperationType, ResultRow, SubmissionId,
    SubmissionInputs,
};

use super::error::MapError;
use super::rows;
use crate::WorkerOutput;

/// Maps one evaluation body, honouring the tombstone flag on a failed job.
pub(super) fn map(
    output: &WorkerOutput,
    inputs: &SubmissionInputs,
    submission_id: SubmissionId,
    dataset_id: DatasetId,
    testcase_id: i32,
    archive_sandbox: bool,
) -> Result<ObjectWrite, MapError> {
    let prior = inputs.result.as_ref().map(rows::stored);
    let before = prior.clone();
    let result = prior.unwrap_or_else(|| rows::invalidated(submission_id, dataset_id));
    if output.success {
        Ok(success(
            output,
            result,
            before,
            submission_id,
            dataset_id,
            testcase_id,
            archive_sandbox,
        ))
    } else if output.tombstone {
        tombstone(inputs, submission_id, dataset_id, before, archive_sandbox)
    } else {
        Ok(retry(
            result,
            before,
            submission_id,
            dataset_id,
            archive_sandbox,
        ))
    }
}

/// A tombstone result either invalidates the compilation or writes nothing.
fn tombstone(
    inputs: &SubmissionInputs,
    submission_id: SubmissionId,
    dataset_id: DatasetId,
    before: Option<ResultRow>,
    archive_sandbox: bool,
) -> Result<ObjectWrite, MapError> {
    if inputs.executables.values().any(FileDigest::is_tombstone) {
        return Ok(invalidate(
            submission_id,
            dataset_id,
            before,
            archive_sandbox,
        ));
    }
    Err(MapError::NoWriteRequired)
}

/// A succeeded testcase adds one evaluation row and leaves the result as it was.
fn success(
    output: &WorkerOutput,
    result: ResultRow,
    before: Option<ResultRow>,
    submission_id: SubmissionId,
    dataset_id: DatasetId,
    testcase_id: i32,
    archive_sandbox: bool,
) -> ObjectWrite {
    let evaluation = evaluation_row(output, submission_id, dataset_id, testcase_id);
    let audit = vec![
        rows::result_audit(before.as_ref(), &result),
        rows::evaluation_audit(&evaluation),
    ];
    ObjectWrite {
        operation: OperationType::Evaluation,
        submission_id,
        dataset_id,
        archive_sandbox,
        result,
        executables: Vec::new(),
        evaluations: vec![evaluation],
        score: None,
        audit,
    }
}

/// The one testcase run, with the body's figures and the sandbox digest order.
fn evaluation_row(
    output: &WorkerOutput,
    submission_id: SubmissionId,
    dataset_id: DatasetId,
    testcase_id: i32,
) -> EvaluationRow {
    let stats = output.stats.as_ref();
    EvaluationRow {
        submission_id,
        dataset_id,
        testcase_id,
        outcome: output.outcome.clone(),
        text: output.text.clone().unwrap_or_default(),
        admin_text: output.admin_text.clone(),
        execution_time: stats.and_then(|stats| stats.execution_time),
        execution_wall_clock_time: stats.and_then(|stats| stats.wall_clock_time),
        execution_memory: stats.and_then(|stats| stats.memory_bytes),
        evaluation_shard: output.shard,
        evaluation_sandbox_paths: Some(output.sandboxes.clone()),
        evaluation_sandbox_digests: rows::sandbox_digests(output),
    }
}

/// A failed evaluation adds one try and no testcase row.
fn retry(
    mut result: ResultRow,
    before: Option<ResultRow>,
    submission_id: SubmissionId,
    dataset_id: DatasetId,
    archive_sandbox: bool,
) -> ObjectWrite {
    result.evaluation_tries += 1;
    let audit = vec![rows::result_audit(before.as_ref(), &result)];
    ObjectWrite {
        operation: OperationType::Evaluation,
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

/// A tombstone executable invalidates the compilation the evaluation ran on.
fn invalidate(
    submission_id: SubmissionId,
    dataset_id: DatasetId,
    before: Option<ResultRow>,
    archive_sandbox: bool,
) -> ObjectWrite {
    // WHY the compilation operation: its commit clears executables, evaluations and score.
    let result = rows::invalidated(submission_id, dataset_id);
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
