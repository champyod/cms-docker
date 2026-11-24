//! The contest-scoped sweep: database candidates turned into queued operations.

use sqlx::postgres::PgConnection;

use cms_db::{
    submission_compilations, submission_evaluations, user_test_compilations, user_test_evaluations,
    CompilationCandidate, EvaluationCandidate,
};
use cms_proto::OperationKind;

use crate::operation::{
    MAX_COMPILATION_TRIES, MAX_EVALUATION_TRIES, MAX_USER_TEST_COMPILATION_TRIES,
    MAX_USER_TEST_EVALUATION_TRIES,
};
use crate::plan::{compilation_priority, evaluation_priority};
use crate::PlannedOperation;

/// Every operation one contest owes, across submissions and user tests.
///
/// A `None` contest sweeps every contest, which is the reference's `get_operations`
/// before the service has a contest override.
///
/// # Errors
///
/// Returns the driver's own error for a candidate read it refused.
pub async fn contest_operations(
    connection: &mut PgConnection,
    contest_id: Option<i32>,
) -> Result<Vec<PlannedOperation>, sqlx::Error> {
    let mut planned = Vec::new();
    planned.extend(submission_work(connection, contest_id).await?);
    planned.extend(user_test_work(connection, contest_id).await?);
    planned.sort_by(|left, right| {
        (
            left.timestamp,
            left.operation.object_id,
            left.operation.dataset_id,
            left.operation.testcase_codename.as_deref(),
        )
            .cmp(&(
                right.timestamp,
                right.operation.object_id,
                right.operation.dataset_id,
                right.operation.testcase_codename.as_deref(),
            ))
    });
    Ok(planned)
}

async fn submission_work(
    connection: &mut PgConnection,
    contest_id: Option<i32>,
) -> Result<Vec<PlannedOperation>, sqlx::Error> {
    let compilations =
        submission_compilations(connection, contest_id, MAX_COMPILATION_TRIES).await?;
    let evaluations = submission_evaluations(connection, contest_id, MAX_EVALUATION_TRIES).await?;
    Ok(compilations
        .into_iter()
        .map(submission_compilation)
        .chain(evaluations.into_iter().map(submission_evaluation))
        .collect())
}

async fn user_test_work(
    connection: &mut PgConnection,
    contest_id: Option<i32>,
) -> Result<Vec<PlannedOperation>, sqlx::Error> {
    let compilations =
        user_test_compilations(connection, contest_id, MAX_USER_TEST_COMPILATION_TRIES).await?;
    let evaluations =
        user_test_evaluations(connection, contest_id, MAX_USER_TEST_EVALUATION_TRIES).await?;
    Ok(compilations
        .into_iter()
        .map(user_test_compilation)
        .chain(evaluations.into_iter().map(user_test_evaluation))
        .collect())
}

fn submission_compilation(candidate: CompilationCandidate) -> PlannedOperation {
    operation(
        OperationKind::Compilation,
        candidate.object_id,
        candidate.dataset_id.0,
        None,
        compilation_priority(candidate.is_active, candidate.tries),
        candidate.timestamp,
    )
}

fn submission_evaluation(candidate: EvaluationCandidate) -> PlannedOperation {
    operation(
        OperationKind::Evaluation,
        candidate.object_id,
        candidate.dataset_id.0,
        candidate.testcase_codename,
        evaluation_priority(candidate.is_active, candidate.tries),
        candidate.timestamp,
    )
}

fn user_test_compilation(candidate: CompilationCandidate) -> PlannedOperation {
    operation(
        OperationKind::UserTestCompilation,
        candidate.object_id,
        candidate.dataset_id.0,
        None,
        compilation_priority(candidate.is_active, candidate.tries),
        candidate.timestamp,
    )
}

fn user_test_evaluation(candidate: EvaluationCandidate) -> PlannedOperation {
    operation(
        OperationKind::UserTestEvaluation,
        candidate.object_id,
        candidate.dataset_id.0,
        None,
        evaluation_priority(candidate.is_active, candidate.tries),
        candidate.timestamp,
    )
}

fn operation(
    kind: OperationKind,
    object_id: i32,
    dataset_id: i32,
    testcase_codename: Option<String>,
    priority: i32,
    timestamp: chrono::NaiveDateTime,
) -> PlannedOperation {
    PlannedOperation {
        operation: cms_proto::Operation {
            kind,
            object_id: i64::from(object_id),
            dataset_id: i64::from(dataset_id),
            testcase_codename,
            archive_sandbox: false,
        },
        priority,
        timestamp,
    }
}
