//! The `invalidate_submission` RPC: clear stored verdicts and re-plan the work.
//!
//! The panel's recalculate/rejudge action sends this method with a level, so a
//! Rust daemon without it would silently refuse a live admin path. Both levels
//! reuse the result's own invalidation methods and the commit's write shape;
//! only the set of rows they clear differs. Waiting operations are removed from
//! this service's queue before the database changes, then the same-by-id
//! planner puts the work still owed back.

use cms_db::{
    commit, dataset_by_id, get_submission_results, get_submissions, group_by_object, DatasetId,
    ObjectWrite, OperationType, ResultFilter, SubmissionFilter, SubmissionId, SubmissionResult,
    CLEAR_SCORE_FOR_COMPILATION,
};
use cms_proto::OperationKind;
use serde_json::Value;

use super::Evaluation;
use crate::invalidation_write;

const METHOD: &str = "invalidate_submission";
const COMPILATION: &str = "compilation";
const EVALUATION: &str = "evaluation";
const LEVEL_ARGUMENT: &str = "level";
const ARCHIVE_ARGUMENT: &str = "archive_sandbox";

/// One validated argument set; absent filters mean every contest.
struct Arguments {
    contest_id: Option<i32>,
    submission_id: Option<i32>,
    dataset_id: Option<i32>,
    testcase_id: Option<i32>,
    participation_id: Option<i32>,
    task_id: Option<i32>,
    level: &'static str,
    archive_sandbox: bool,
}

/// Handles the RPC and returns the reference's null result.
///
/// # Errors
///
/// Refuses an unknown level, a malformed filter or a database failure.
pub(super) fn handle(data: &Value, evaluation: &Evaluation) -> Result<Value, String> {
    evaluation.runtime.block_on(apply_value(data, evaluation))
}

/// The async form callers already on a runtime use, with the same arguments.
pub(super) async fn apply_value(data: &Value, evaluation: &Evaluation) -> Result<Value, String> {
    let arguments = Arguments::read(data)?;
    apply(evaluation, arguments).await?;
    Ok(Value::Null)
}

impl Arguments {
    fn read(data: &Value) -> Result<Self, String> {
        let level = match data.get(LEVEL_ARGUMENT).and_then(Value::as_str) {
            None | Some(COMPILATION) => COMPILATION,
            Some(EVALUATION) => EVALUATION,
            Some(other) => {
                return Err(format!(
                    "{METHOD}() unexpected invalidation level `{other}`"
                ));
            }
        };
        Ok(Self {
            contest_id: super::optional_i32(data, "contest_id", METHOD)?,
            submission_id: super::optional_i32(data, "submission_id", METHOD)?,
            dataset_id: super::optional_i32(data, "dataset_id", METHOD)?,
            testcase_id: super::optional_i32(data, "testcase_id", METHOD)?,
            participation_id: super::optional_i32(data, "participation_id", METHOD)?,
            task_id: super::optional_i32(data, "task_id", METHOD)?,
            level,
            archive_sandbox: data
                .get(ARCHIVE_ARGUMENT)
                .and_then(Value::as_bool)
                .unwrap_or(false),
        })
    }

    fn submission_filter(&self) -> SubmissionFilter {
        SubmissionFilter {
            submission_id: self.submission_id.map(SubmissionId),
            participation_id: self.participation_id,
            task_id: self.task_id,
            contest_id: self.contest_only(),
        }
    }

    fn result_filter(&self) -> ResultFilter {
        ResultFilter {
            submission_id: self.submission_id.map(SubmissionId),
            participation_id: self.participation_id,
            task_id: self.task_id,
            contest_id: self.contest_only(),
            dataset_id: self.dataset_id.map(DatasetId),
        }
    }

    /// A contest filter applies only when no narrower object was named.
    fn contest_only(&self) -> Option<i32> {
        if self.participation_id.is_none() && self.task_id.is_none() && self.submission_id.is_none()
        {
            self.contest_id
        } else {
            None
        }
    }
}

async fn apply(evaluation: &Evaluation, arguments: Arguments) -> Result<(), String> {
    let mut transaction = evaluation
        .session()
        .begin()
        .await
        .map_err(|error| format!("begin invalidation: {error}"))?;
    let mut arguments = arguments;
    resolve_dataset_task(&mut transaction, &mut arguments).await?;
    arguments
        .submission_filter()
        .validate()
        .map_err(|e| e.to_string())?;
    arguments
        .result_filter()
        .validate()
        .map_err(|e| e.to_string())?;
    let submissions = get_submissions(transaction.connection(), &arguments.submission_filter())
        .await
        .map_err(|error| format!("read submissions: {error}"))?;
    let ids: Vec<i32> = submissions.iter().map(|item| item.record.id.0).collect();
    dequeue(evaluation, &arguments, &ids);
    let writes = invalidate_results(&mut transaction, &arguments).await?;
    commit(transaction.connection(), &writes)
        .await
        .map_err(|error| format!("commit invalidation: {error}"))?;
    transaction
        .commit()
        .await
        .map_err(|error| format!("commit invalidation transaction: {error}"))?;
    for id in ids {
        evaluation
            .enqueue_submission_with(id, arguments.archive_sandbox)
            .await
            .map_err(|error| format!("re-enqueue submission {id}: {error}"))?;
    }
    Ok(())
}

/// A dataset named on its own implies the task that owns its testcases.
async fn resolve_dataset_task(
    transaction: &mut cms_db::Transaction,
    arguments: &mut Arguments,
) -> Result<(), String> {
    if arguments.dataset_id.is_none()
        || arguments.task_id.is_some()
        || arguments.submission_id.is_some()
    {
        return Ok(());
    }
    let Some(dataset_id) = arguments.dataset_id else {
        return Ok(());
    };
    let dataset = dataset_by_id(transaction.connection(), DatasetId(dataset_id))
        .await
        .map_err(|error| format!("read invalidated dataset: {error}"))?;
    arguments.task_id = Some(
        dataset
            .ok_or_else(|| "invalidated dataset is missing".to_owned())?
            .task_id,
    );
    Ok(())
}

fn dequeue(evaluation: &Evaluation, arguments: &Arguments, ids: &[i32]) {
    let level = arguments.level;
    let dataset_id = arguments.dataset_id;
    evaluation.remove_matching(|operation| {
        if !ids.contains(&(operation.object_id as i32)) {
            return false;
        }
        if dataset_id.is_some_and(|dataset| i64::from(dataset) != operation.dataset_id) {
            return false;
        }
        operation.kind == OperationKind::Evaluation
            || (level == COMPILATION && operation.kind == OperationKind::Compilation)
    });
}

async fn invalidate_results(
    transaction: &mut cms_db::Transaction,
    arguments: &Arguments,
) -> Result<Vec<ObjectWrite>, String> {
    let results = get_submission_results(transaction.connection(), &arguments.result_filter())
        .await
        .map_err(|error| format!("read results: {error}"))?;
    let operation = if arguments.level == COMPILATION {
        OperationType::Compilation
    } else {
        OperationType::Evaluation
    };
    let mut writes = Vec::with_capacity(results.len());
    for mut result in results {
        let before = result.clone();
        invalidate_one(transaction, &mut result, arguments).await?;
        clear_score(transaction, &result).await?;
        writes.push(
            invalidation_write(&before, &result, operation, arguments.archive_sandbox)
                .seal()
                .map_err(|error| error.to_string())?,
        );
    }
    group_by_object(&writes).map_err(|error| error.to_string())
}

async fn invalidate_one(
    transaction: &mut cms_db::Transaction,
    result: &mut SubmissionResult,
    arguments: &Arguments,
) -> Result<(), String> {
    if arguments.level == COMPILATION {
        result
            .invalidate_compilation(transaction.connection())
            .await
            .map_err(|error| format!("invalidate compilation: {error}"))
    } else {
        result
            .invalidate_evaluation(transaction.connection(), arguments.testcase_id)
            .await
            .map_err(|error| format!("invalidate evaluation: {error}"))
    }
}

async fn clear_score(
    transaction: &mut cms_db::Transaction,
    result: &SubmissionResult,
) -> Result<(), String> {
    sqlx::query(CLEAR_SCORE_FOR_COMPILATION)
        .bind(result.submission_id.0)
        .bind(result.dataset_id.0)
        .execute(transaction.connection())
        .await
        .map_err(|error| format!("clear score: {error}"))?;
    Ok(())
}
