//! Shared row shapes and audit recipes for the two submission operations.

use cms_db::{
    AuditRow, DatasetId, EvaluationRow, ExecutableRow, FileDigest, ResultRow, RowState,
    SubmissionId, SubmissionResult,
};

use super::error::MapError;
use crate::WorkerOutput;

const REASON: &str = "judging commit";
const RESULT_ENTITY: &str = "submission_results";
const EVALUATION_ENTITY: &str = "evaluations";
const EXECUTABLE_ENTITY: &str = "executables";
const CREATE_RESULT: &str = "submissionresult:create";
const UPDATE_RESULT: &str = "submissionresult:update";
const CREATE_EVALUATION: &str = "evaluation:create";
const CREATE_EXECUTABLE: &str = "executable:create";

/// The row `invalidate_compilation` leaves before a compilation fills it.
pub(super) fn invalidated(submission_id: SubmissionId, dataset_id: DatasetId) -> ResultRow {
    ResultRow {
        submission_id,
        dataset_id,
        compilation_outcome: None,
        compilation_text: Vec::new(),
        compilation_tries: 0,
        compilation_stdout: None,
        compilation_stderr: None,
        compilation_time: None,
        compilation_wall_clock_time: None,
        compilation_memory: None,
        compilation_shard: None,
        compilation_sandbox_paths: None,
        compilation_sandbox_digests: None,
        evaluation_outcome: None,
        evaluation_tries: 0,
    }
}

/// Copies a stored result into the row shape the statements bind.
pub(super) fn stored(prior: &SubmissionResult) -> ResultRow {
    let mut row = invalidated(prior.submission_id, prior.dataset_id);
    row.compilation_outcome = prior.compilation_outcome;
    row.compilation_text.clone_from(&prior.compilation_text);
    row.compilation_tries = prior.compilation_tries;
    row.compilation_stdout.clone_from(&prior.compilation_stdout);
    row.compilation_stderr.clone_from(&prior.compilation_stderr);
    row.compilation_time = prior.compilation_time;
    row.compilation_wall_clock_time = prior.compilation_wall_clock_time;
    row.compilation_memory = prior.compilation_memory;
    row.compilation_shard = prior.compilation_shard;
    row.compilation_sandbox_paths
        .clone_from(&prior.compilation_sandbox_paths);
    row.compilation_sandbox_digests
        .clone_from(&prior.compilation_sandbox_digests);
    row.evaluation_outcome = prior.evaluation_outcome;
    row.evaluation_tries = prior.evaluation_tries;
    row
}

/// The digests in sandbox order, or `None` if any sandbox has no digest.
pub(super) fn sandbox_digests(output: &WorkerOutput) -> Option<Vec<String>> {
    if output.sandbox_digests.is_empty() {
        return None;
    }
    output
        .sandboxes
        .iter()
        .map(|path| output.sandbox_digests.get(path).cloned())
        .collect()
}

/// Parses each produced executable's digest before it reaches a statement.
pub(super) fn executable_rows(
    output: &WorkerOutput,
    submission_id: SubmissionId,
    dataset_id: DatasetId,
) -> Result<Vec<ExecutableRow>, MapError> {
    output
        .executables
        .iter()
        .map(|(filename, digest)| {
            let digest =
                digest
                    .parse::<FileDigest>()
                    .map_err(|source| MapError::BadExecutableDigest {
                        filename: filename.clone(),
                        detail: source.to_string(),
                    })?;
            Ok(ExecutableRow {
                submission_id,
                dataset_id,
                filename: filename.clone(),
                digest,
            })
        })
        .collect()
}

/// The result audit row: only this one carries the state the batch replaced.
pub(super) fn result_audit(before: Option<&ResultRow>, after: &ResultRow) -> AuditRow {
    let verb = if before.is_some() {
        UPDATE_RESULT
    } else {
        CREATE_RESULT
    };
    AuditRow {
        actor_id: None,
        verb: verb.to_string(),
        entity: RESULT_ENTITY.to_string(),
        entity_id: object_key(&after.submission_id, &after.dataset_id),
        before: before.cloned().map(RowState::Result),
        after: RowState::Result(after.clone()),
        reason: REASON.to_string(),
    }
}

/// The audit row for a newly written evaluation.
pub(super) fn evaluation_audit(row: &EvaluationRow) -> AuditRow {
    AuditRow {
        actor_id: None,
        verb: CREATE_EVALUATION.to_string(),
        entity: EVALUATION_ENTITY.to_string(),
        entity_id: format!(
            "{}/{}/{}",
            row.submission_id, row.dataset_id, row.testcase_id
        ),
        before: None,
        after: RowState::Evaluation(row.clone()),
        reason: REASON.to_string(),
    }
}

/// The audit row for a newly written executable.
pub(super) fn executable_audit(row: &ExecutableRow) -> AuditRow {
    AuditRow {
        actor_id: None,
        verb: CREATE_EXECUTABLE.to_string(),
        entity: EXECUTABLE_ENTITY.to_string(),
        entity_id: format!("{}/{}/{}", row.submission_id, row.dataset_id, row.filename),
        before: None,
        after: RowState::Executable(row.clone()),
        reason: REASON.to_string(),
    }
}

fn object_key(submission_id: &SubmissionId, dataset_id: &DatasetId) -> String {
    format!("{submission_id}/{dataset_id}")
}
