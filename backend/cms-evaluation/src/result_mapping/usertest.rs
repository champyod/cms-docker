//! Pure mapping of one returned user-test body into a `UserTestWrite`.
//!
//! Compilation success replaces the executable set and clears the evaluation
//! half; evaluation success writes only the evaluation columns on the same
//! result row. A failed half increments its own try count and leaves the rest
//! of the stored row alone, which is `write_results_one_row` in `Job.py:751-760`.

use cms_db::{
    AuditRow, CompilationOutcome, FileDigest, RowState, UserTestExecutableRow, UserTestInputs,
    UserTestOperation, UserTestResult, UserTestResultRow, UserTestWrite,
};
use cms_proto::{Operation, OperationKind};

use super::error::MapError;
use super::rows;
use crate::WorkerOutput;

const REASON: &str = "judging commit";
const RESULT_ENTITY: &str = "user_test_results";
const EXECUTABLE_ENTITY: &str = "user_test_executables";
const CREATE_RESULT: &str = "usertest:create";
const UPDATE_RESULT: &str = "usertest:update";
const CREATE_EXECUTABLE: &str = "executable:create";

/// Maps one returned user-test body into the write its operation calls for.
///
/// # Errors
///
/// Returns [`MapError`] when the operation names another object, when an
/// executable's filename or digest violates its domain, or when the operation
/// is a submission rather than a user test.
pub fn map_user_test_result(
    output: &WorkerOutput,
    operation: &Operation,
    inputs: &UserTestInputs,
    prior: Option<&UserTestResult>,
) -> Result<UserTestWrite, MapError> {
    let user_test_id = inputs.user_test.id;
    let dataset_id = inputs.dataset.id.0;
    if operation.object_id != i64::from(user_test_id) {
        return Err(MapError::WrongObjectId {
            operation: operation.object_id,
            inputs: i64::from(user_test_id),
        });
    }
    if operation.dataset_id != i64::from(dataset_id) {
        return Err(MapError::WrongDatasetId {
            operation: operation.dataset_id,
            inputs: i64::from(dataset_id),
        });
    }
    match operation.kind {
        OperationKind::UserTestCompilation => compilation(output, user_test_id, dataset_id, prior),
        OperationKind::UserTestEvaluation => {
            Ok(evaluation(output, user_test_id, dataset_id, prior))
        }
        other => Err(MapError::UnsupportedOperation { kind: other.name() }),
    }
}

/// The stored row as the write shape binds it, with no executables attached.
fn stored_row(prior: &UserTestResult) -> UserTestResultRow {
    let mut row = UserTestResultRow::new(prior.user_test_id, prior.dataset_id);
    row.output = prior.output.clone();
    row.compilation_outcome = prior
        .compilation_outcome
        .map(|outcome| outcome.as_str().to_owned());
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
    row.evaluation_outcome = prior
        .evaluation_outcome
        .map(|outcome| outcome.as_str().to_owned());
    row.evaluation_text.clone_from(&prior.evaluation_text);
    row.evaluation_tries = prior.evaluation_tries;
    row.execution_time = prior.execution_time;
    row.execution_wall_clock_time = prior.execution_wall_clock_time;
    row.execution_memory = prior.execution_memory;
    row.evaluation_shard = prior.evaluation_shard;
    row.evaluation_sandbox_paths
        .clone_from(&prior.evaluation_sandbox_paths);
    row.evaluation_sandbox_digests
        .clone_from(&prior.evaluation_sandbox_digests);
    row
}

fn compilation(
    output: &WorkerOutput,
    user_test_id: i32,
    dataset_id: i32,
    prior: Option<&UserTestResult>,
) -> Result<UserTestWrite, MapError> {
    let before = prior.map(stored_row);
    if !output.success {
        return Ok(failure(
            before
                .as_ref()
                .cloned()
                .unwrap_or_else(|| UserTestResultRow::new(user_test_id, dataset_id)),
            before.as_ref(),
        ));
    }
    let stats = output.stats.as_ref();
    let mut result = UserTestResultRow::new(user_test_id, dataset_id);
    result.compilation_outcome = output.compilation_success.map(|success| {
        if success {
            CompilationOutcome::Ok.as_str().to_owned()
        } else {
            CompilationOutcome::Fail.as_str().to_owned()
        }
    });
    result.compilation_text = output.text.clone().unwrap_or_default();
    result.compilation_stdout = stats.and_then(|stats| stats.stdout.clone());
    result.compilation_stderr = stats.and_then(|stats| stats.stderr.clone());
    result.compilation_time = stats.and_then(|stats| stats.execution_time);
    result.compilation_wall_clock_time = stats.and_then(|stats| stats.wall_clock_time);
    result.compilation_memory = stats.and_then(|stats| stats.memory_bytes);
    result.compilation_shard = output.shard;
    result.compilation_sandbox_paths = Some(output.sandboxes.clone());
    result.compilation_sandbox_digests = rows::sandbox_digests(output);

    let executables = executable_rows(output, user_test_id, dataset_id)?;
    Ok(write(
        UserTestOperation::Compilation,
        result,
        executables,
        before.as_ref(),
    ))
}

fn evaluation(
    output: &WorkerOutput,
    user_test_id: i32,
    dataset_id: i32,
    prior: Option<&UserTestResult>,
) -> UserTestWrite {
    let before = prior.map(stored_row);
    if !output.success {
        let mut result = before
            .as_ref()
            .cloned()
            .unwrap_or_else(|| UserTestResultRow::new(user_test_id, dataset_id));
        result.evaluation_tries += 1;
        return write(
            UserTestOperation::Evaluation,
            result,
            Vec::new(),
            before.as_ref(),
        );
    }
    let stats = output.stats.as_ref();
    let mut result = before
        .as_ref()
        .cloned()
        .unwrap_or_else(|| UserTestResultRow::new(user_test_id, dataset_id));
    result.output = output.user_output.clone();
    result.evaluation_outcome = Some("ok".to_owned());
    result.evaluation_text = output.text.clone().unwrap_or_default();
    result.execution_time = stats.and_then(|stats| stats.execution_time);
    result.execution_wall_clock_time = stats.and_then(|stats| stats.wall_clock_time);
    result.execution_memory = stats.and_then(|stats| stats.memory_bytes);
    result.evaluation_shard = output.shard;
    result.evaluation_sandbox_paths = Some(output.sandboxes.clone());
    result.evaluation_sandbox_digests = rows::sandbox_digests(output);
    write(
        UserTestOperation::Evaluation,
        result,
        Vec::new(),
        before.as_ref(),
    )
}

/// Builds the write and its audit declarations from the finished row.
fn write(
    operation: UserTestOperation,
    result: UserTestResultRow,
    executables: Vec<UserTestExecutableRow>,
    before: Option<&UserTestResultRow>,
) -> UserTestWrite {
    let mut audit = vec![result_audit(before, &result)];
    audit.extend(executables.iter().map(executable_audit));
    UserTestWrite {
        operation,
        result,
        executables,
        audit,
    }
}

/// Applies the domain checks the executable table enforces before the write.
fn executable_rows(
    output: &WorkerOutput,
    user_test_id: i32,
    dataset_id: i32,
) -> Result<Vec<UserTestExecutableRow>, MapError> {
    output
        .executables
        .iter()
        .map(|(filename, text)| {
            let digest =
                text.parse::<FileDigest>()
                    .map_err(|source| MapError::BadExecutableDigest {
                        filename: filename.clone(),
                        detail: source.to_string(),
                    })?;
            UserTestExecutableRow::new(user_test_id, dataset_id, filename, digest).map_err(
                |source| MapError::BadUserTestFilename {
                    filename: filename.clone(),
                    detail: source.to_string(),
                },
            )
        })
        .collect()
}

fn failure(mut result: UserTestResultRow, before: Option<&UserTestResultRow>) -> UserTestWrite {
    result.compilation_tries += 1;
    write(UserTestOperation::Compilation, result, Vec::new(), before)
}

fn result_audit(before: Option<&UserTestResultRow>, after: &UserTestResultRow) -> AuditRow {
    AuditRow {
        actor_id: None,
        verb: if before.is_some() {
            UPDATE_RESULT.to_owned()
        } else {
            CREATE_RESULT.to_owned()
        },
        entity: RESULT_ENTITY.to_owned(),
        entity_id: format!("{}/{}", after.user_test_id, after.dataset_id),
        before: before.cloned().map(RowState::UserTestResult),
        after: RowState::UserTestResult(after.clone()),
        reason: REASON.to_owned(),
    }
}

fn executable_audit(row: &UserTestExecutableRow) -> AuditRow {
    AuditRow {
        actor_id: None,
        verb: CREATE_EXECUTABLE.to_owned(),
        entity: EXECUTABLE_ENTITY.to_owned(),
        entity_id: format!(
            "{}/{}/{}",
            row.user_test_id,
            row.dataset_id,
            row.filename.as_str()
        ),
        before: None,
        after: RowState::UserTestExecutable(row.clone()),
        reason: REASON.to_owned(),
    }
}
