//! Exact evaluation writes, retries, sandbox lists and tombstone branches.

use cms_db::{
    AuditRow, EvaluationRow, ObjectWrite, OperationType, ResultRow, RowState, SubmissionInputs,
};
use cms_evaluation::{map_result, worker_output, MapError, WorkerOutput};
use cms_proto::OperationKind;
use serde_json::{json, Value};

use super::support::{
    blank_row, evaluation_body, inputs, operation, prior_result, prior_row, with_executable,
    with_tombstone, DATASET_ID, DIGEST, GRADER_TEXT, OTHER_DIGEST, SUBMISSION_ID, TESTCASE_ID,
};

fn output(body: &Value) -> WorkerOutput {
    worker_output(body.as_object().expect("an object body")).expect("a valid body")
}

fn run(body: &Value, inputs: &SubmissionInputs) -> Result<ObjectWrite, MapError> {
    map_result(
        &output(body),
        &operation(OperationKind::Evaluation, Some("alpha"), false),
        inputs,
    )
}

fn expected_evaluation() -> EvaluationRow {
    EvaluationRow {
        submission_id: SUBMISSION_ID,
        dataset_id: DATASET_ID,
        testcase_id: TESTCASE_ID,
        outcome: Some("1.0".to_string()),
        text: vec![GRADER_TEXT.to_string()],
        admin_text: Some("internal note".to_string()),
        execution_time: Some(0.5),
        execution_wall_clock_time: Some(0.6),
        execution_memory: Some(2048),
        evaluation_shard: None,
        evaluation_sandbox_paths: Some(vec!["box/one".to_string(), "box/two".to_string()]),
        evaluation_sandbox_digests: Some(vec![DIGEST.to_string(), OTHER_DIGEST.to_string()]),
    }
}

fn result_audit(before: Option<ResultRow>, after: ResultRow, verb: &str) -> AuditRow {
    AuditRow {
        actor_id: None,
        verb: verb.to_string(),
        entity: "submission_results".to_string(),
        entity_id: "41/9".to_string(),
        before: before.map(RowState::Result),
        after: RowState::Result(after),
        reason: "judging commit".to_string(),
    }
}

#[test]
fn a_successful_evaluation_preserves_the_result_and_adds_one_evaluation() {
    let write = run(&evaluation_body(true), &inputs(Some(prior_result())))
        .expect("a submission evaluation maps");

    assert_eq!(write.operation, OperationType::Evaluation);
    assert_eq!(write.result, prior_row());
    assert_eq!(write.evaluations, vec![expected_evaluation()]);
    assert!(write.executables.is_empty());
    assert!(write.score.is_none());
    assert_eq!(
        write.audit,
        vec![
            result_audit(Some(prior_row()), prior_row(), "submissionresult:update"),
            AuditRow {
                actor_id: None,
                verb: "evaluation:create".to_string(),
                entity: "evaluations".to_string(),
                entity_id: "41/9/3".to_string(),
                before: None,
                after: RowState::Evaluation(expected_evaluation()),
                reason: "judging commit".to_string(),
            },
        ]
    );
}

#[test]
fn a_failed_evaluation_only_increments_evaluation_tries() {
    let write = run(&evaluation_body(false), &inputs(Some(prior_result())))
        .expect("a submission evaluation maps");
    let mut expected = prior_row();
    expected.evaluation_tries = 5;

    assert_eq!(write.result, expected);
    assert!(write.evaluations.is_empty());
    assert!(write.executables.is_empty());
    assert_eq!(
        write.audit,
        vec![result_audit(
            Some(prior_row()),
            expected,
            "submissionresult:update"
        )]
    );
}

#[test]
fn a_write_without_a_predecessor_creates_the_result_row() {
    let write = run(&evaluation_body(false), &inputs(None)).expect("a submission evaluation maps");
    let mut expected = blank_row();
    expected.evaluation_tries = 1;

    assert_eq!(write.result, expected);
    assert_eq!(
        write.audit,
        vec![result_audit(None, expected, "submissionresult:create")]
    );
}

#[test]
fn sandbox_digests_follow_the_sandbox_order_and_any_missing_digest_empties_the_list() {
    let mut ordered = evaluation_body(true);
    ordered["sandboxes"] = json!(["box/two", "box/one"]);
    let write = run(&ordered, &inputs(None)).expect("the ordered body maps");
    assert_eq!(
        write.evaluations[0].evaluation_sandbox_digests,
        Some(vec![OTHER_DIGEST.to_string(), DIGEST.to_string()])
    );

    let mut missing = evaluation_body(true);
    missing["sandbox_digests"] = json!({"box/one": DIGEST});
    let write = run(&missing, &inputs(None)).expect("the partial body maps");
    assert_eq!(
        write.evaluations[0]
            .evaluation_sandbox_paths
            .as_ref()
            .map(Vec::len),
        Some(2)
    );
    assert_eq!(write.evaluations[0].evaluation_sandbox_digests, None);

    let mut empty = evaluation_body(true);
    empty["sandbox_digests"] = json!({});
    let write = run(&empty, &inputs(None)).expect("the empty body maps");
    assert_eq!(write.evaluations[0].evaluation_sandbox_digests, None);
}

#[test]
fn a_tombstone_failed_evaluation_invalidates_the_compilation() {
    let inputs = with_executable(inputs(Some(prior_result())), "x");
    let write = run(&with_tombstone(evaluation_body(false)), &inputs)
        .expect("a tombstone executable maps to an invalidation");

    assert_eq!(write.operation, OperationType::Compilation);
    assert_eq!(write.result, blank_row());
    assert!(write.executables.is_empty());
    assert!(write.evaluations.is_empty());
    assert!(write.score.is_none());
    assert_eq!(
        write.audit,
        vec![result_audit(
            Some(prior_row()),
            blank_row(),
            "submissionresult:update"
        )]
    );
}

#[test]
fn a_tombstone_flag_without_a_tombstone_executable_needs_no_write() {
    let inputs = with_executable(inputs(Some(prior_result())), DIGEST);
    assert_eq!(
        run(&with_tombstone(evaluation_body(false)), &inputs),
        Err(MapError::NoWriteRequired)
    );
}

#[test]
fn a_tombstone_executable_without_the_flag_is_an_evaluation_retry() {
    let inputs = with_executable(inputs(Some(prior_result())), "x");
    let write = run(&evaluation_body(false), &inputs).expect("the ordinary retry maps");

    let mut expected = prior_row();
    expected.evaluation_tries = 5;
    assert_eq!(write.operation, OperationType::Evaluation);
    assert_eq!(write.result, expected);
}

#[test]
fn an_archived_evaluation_carries_the_flag_into_its_write() {
    let inputs = inputs(None);
    let write = map_result(
        &output(&evaluation_body(true)),
        &operation(OperationKind::Evaluation, Some("alpha"), true),
        &inputs,
    )
    .expect("a submission evaluation maps");
    assert!(write.archive_sandbox);
}
