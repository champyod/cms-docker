//! One popped operation: read its inputs, dispatch, map, commit, then apply
//! the reference's end-of-operation effects.
//!
//! The operation's object id selects the worker shard, so a multi-shard
//! deployment spreads objects deterministically without a second config knob.
//! Database work stays on one transaction until every mapped row has been
//! written; effects run only after that transaction commits.

use cms_db::{
    commit, commit_user_test, group_by_object, submission_inputs, user_test_inputs,
    user_test_result, DatasetId, ObjectWrite, SubmissionId, UserTestWrite,
};
use cms_proto::{Operation, OperationKind};
use cms_svc::Client;

use super::effects;
use crate::dispatch::WorkerDispatcher;
use crate::queue::EvaluationOperation;
use crate::result_mapping::MapError;
use crate::service::Evaluation;
use crate::{
    map_result, map_user_test_result, run_submission, run_user_test, RunnerError, WorkerOutput,
};

/// Why one operation could not be finished.
#[derive(Debug)]
pub(super) enum WorkError {
    /// A transaction could not begin or commit.
    Transaction(String),
    /// The operation named an id outside the database's integer columns.
    Id(String),
    /// One of the named input reads refused or found no row.
    Input(String),
    /// A job could not be built, dispatched or parsed.
    Run(RunnerError),
    /// A returned body could not be mapped to a write.
    Map(MapError),
    /// A group carried no audit row.
    Group(String),
    /// The write transaction refused a statement.
    Commit(String),
    /// An effect after the commit failed.
    Effect(String),
}

impl std::fmt::Display for WorkError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Transaction(reason) => write!(formatter, "transaction: {reason}"),
            Self::Id(reason) => write!(formatter, "operation id: {reason}"),
            Self::Input(reason) => write!(formatter, "inputs: {reason}"),
            Self::Run(error) => write!(formatter, "{error}"),
            Self::Map(error) => write!(formatter, "result mapping: {error}"),
            Self::Group(error) => write!(formatter, "write grouping: {error}"),
            Self::Commit(error) => write!(formatter, "write commit: {error}"),
            Self::Effect(error) => write!(formatter, "effect: {error}"),
        }
    }
}

/// Runs one operation end to end, returning an error the worker loop can log.
///
/// # Errors
///
/// Returns [`WorkError`] naming the read, dispatch, mapping, commit or effect
/// that refused the operation. A refused operation is not re-enqueued here;
/// the next sweep discovers whatever the database still owes.
pub(super) async fn process_one(
    evaluation: &Evaluation,
    dispatcher: &mut WorkerDispatcher,
    scoring: &mut Option<Client>,
    queued: EvaluationOperation,
    _timestamp: chrono::NaiveDateTime,
) -> Result<(), WorkError> {
    let operation = queued.operation;
    let (object_id, dataset_id) = ids(&operation)?;
    if dispatcher.is_empty() {
        return Err(WorkError::Input(
            "no worker addresses are configured".to_owned(),
        ));
    }
    let shard = usize::try_from(object_id).unwrap_or_default() % dispatcher.len();
    let mut transaction = evaluation
        .session()
        .begin()
        .await
        .map_err(|error| WorkError::Transaction(error.to_string()))?;
    let kind = operation.kind;
    let outputs = if is_user_test(kind) {
        write_user_test(&mut transaction, &operation, dispatcher, shard).await?
    } else {
        write_submission(&mut transaction, &operation, dispatcher, shard).await?
    };
    transaction
        .commit()
        .await
        .map_err(|error| WorkError::Transaction(error.to_string()))?;
    apply_effects(evaluation, scoring, kind, object_id, dataset_id, &outputs).await
}

async fn apply_effects(
    evaluation: &Evaluation,
    scoring: &mut Option<Client>,
    kind: OperationKind,
    object_id: i32,
    dataset_id: i32,
    outputs: &[WorkerOutput],
) -> Result<(), WorkError> {
    if is_user_test(kind) {
        effects::after_user_test(evaluation, kind, object_id, dataset_id)
            .await
            .map_err(WorkError::Effect)
    } else {
        effects::after_submission(evaluation, scoring, kind, object_id, dataset_id, outputs)
            .await
            .map_err(WorkError::Effect)
    }
}

async fn write_submission(
    transaction: &mut cms_db::Transaction,
    operation: &Operation,
    dispatcher: &mut WorkerDispatcher,
    shard: usize,
) -> Result<Vec<WorkerOutput>, WorkError> {
    let (object_id, dataset_id) = ids(operation)?;
    let inputs = submission_inputs(
        transaction.connection(),
        SubmissionId(object_id),
        DatasetId(dataset_id),
    )
    .await
    .map_err(|error| WorkError::Input(error.to_string()))?
    .ok_or_else(|| WorkError::Input(format!("submission {object_id}({dataset_id}) is missing")))?;
    let outputs = run_submission(operation, &inputs, dispatcher, shard).map_err(WorkError::Run)?;
    let writes = map_writes(&outputs, operation, &inputs)?;
    commit(transaction.connection(), &writes)
        .await
        .map_err(|error| WorkError::Commit(error.to_string()))?;
    Ok(outputs)
}

fn map_writes(
    outputs: &[WorkerOutput],
    operation: &Operation,
    inputs: &cms_db::SubmissionInputs,
) -> Result<Vec<ObjectWrite>, WorkError> {
    let mut writes = Vec::new();
    for output in outputs {
        match map_result(output, operation, inputs) {
            Ok(write) => writes.push(
                write
                    .seal()
                    .map_err(|error| WorkError::Group(error.to_string()))?,
            ),
            Err(MapError::NoWriteRequired) => {}
            Err(error) => return Err(WorkError::Map(error)),
        }
    }
    group_by_object(&writes).map_err(|error| WorkError::Group(error.to_string()))
}

async fn write_user_test(
    transaction: &mut cms_db::Transaction,
    operation: &Operation,
    dispatcher: &mut WorkerDispatcher,
    shard: usize,
) -> Result<Vec<WorkerOutput>, WorkError> {
    let (object_id, dataset_id) = ids(operation)?;
    let inputs = user_test_inputs(transaction.connection(), object_id, DatasetId(dataset_id))
        .await
        .map_err(|error| WorkError::Input(error.to_string()))?;
    let prior = user_test_result(transaction.connection(), object_id, DatasetId(dataset_id))
        .await
        .map_err(|error| WorkError::Input(error.to_string()))?;
    let outputs = run_user_test(operation, &inputs, dispatcher, shard).map_err(WorkError::Run)?;
    let mut writes: Vec<UserTestWrite> = Vec::with_capacity(outputs.len());
    for output in &outputs {
        let write = map_user_test_result(output, operation, &inputs, prior.as_ref())
            .map_err(WorkError::Map)?;
        writes.push(
            write
                .seal()
                .map_err(|error| WorkError::Group(error.to_string()))?,
        );
    }
    commit_user_test(transaction.connection(), &writes)
        .await
        .map_err(|error| WorkError::Commit(error.to_string()))?;
    Ok(outputs)
}

fn ids(operation: &Operation) -> Result<(i32, i32), WorkError> {
    let object = i32::try_from(operation.object_id).map_err(|_| {
        WorkError::Id(format!(
            "object {} is not an integer id",
            operation.object_id
        ))
    })?;
    let dataset = i32::try_from(operation.dataset_id).map_err(|_| {
        WorkError::Id(format!(
            "dataset {} is not an integer id",
            operation.dataset_id
        ))
    })?;
    Ok((object, dataset))
}

fn is_user_test(kind: OperationKind) -> bool {
    matches!(
        kind,
        OperationKind::UserTestCompilation | OperationKind::UserTestEvaluation
    )
}
