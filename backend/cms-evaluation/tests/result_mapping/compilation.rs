//! Exact compilation writes: invalidated result, executables and audit rows.

use cms_db::{
    AuditRow, CompilationOutcome, ExecutableRow, ObjectWrite, OperationType, ResultRow, RowState,
    SubmissionResult,
};
use cms_evaluation::{map_result, worker_output, WorkerOutput};
use cms_proto::OperationKind;
use serde_json::Value;

use super::support::{
    blank_row, compilation_body, inputs, operation, prior_result, prior_row, COMPILER_TEXT,
    DATASET_ID, DIGEST, OTHER_DIGEST, SUBMISSION_ID,
};

fn output(body: &Value) -> WorkerOutput {
    worker_output(body.as_object().expect("an object body")).expect("a valid body")
}

fn mapped(body: &Value, result: Option<SubmissionResult>) -> ObjectWrite {
    let inputs = inputs(result);
    map_result(
        &output(body),
        &operation(OperationKind::Compilation, None, false),
        &inputs,
    )
    .expect("a submission compilation maps")
}

fn expected_result() -> ResultRow {
    ResultRow {
        compilation_outcome: Some(CompilationOutcome::Ok),
        compilation_text: vec![COMPILER_TEXT.to_string()],
        compilation_tries: 0,
        compilation_stdout: Some("out".to_string()),
        compilation_stderr: Some("err".to_string()),
        compilation_time: Some(0.5),
        compilation_wall_clock_time: Some(0.6),
        compilation_memory: Some(2048),
        compilation_shard: None,
        compilation_sandbox_paths: Some(vec!["box/one".to_string(), "box/two".to_string()]),
        compilation_sandbox_digests: Some(vec![DIGEST.to_string(), OTHER_DIGEST.to_string()]),
        evaluation_outcome: None,
        evaluation_tries: 0,
        ..blank_row()
    }
}

fn expected_executable() -> ExecutableRow {
    ExecutableRow {
        submission_id: SUBMISSION_ID,
        dataset_id: DATASET_ID,
        filename: "a.out".to_string(),
        digest: DIGEST.parse().expect("a valid fixture digest"),
    }
}

#[test]
fn a_successful_compilation_invalidates_then_fills_only_compilation_fields() {
    let write = mapped(&compilation_body(true), Some(prior_result()));

    assert_eq!(write.operation, OperationType::Compilation);
    assert_eq!(write.result, expected_result());
    assert_eq!(write.executables, vec![expected_executable()]);
    assert!(write.evaluations.is_empty());
    assert!(write.score.is_none());
    assert!(!write.archive_sandbox);

    let expected_audit = vec![
        AuditRow {
            actor_id: None,
            verb: "submissionresult:update".to_string(),
            entity: "submission_results".to_string(),
            entity_id: "41/9".to_string(),
            before: Some(RowState::Result(prior_row())),
            after: RowState::Result(expected_result()),
            reason: "judging commit".to_string(),
        },
        AuditRow {
            actor_id: None,
            verb: "executable:create".to_string(),
            entity: "executables".to_string(),
            entity_id: "41/9/a.out".to_string(),
            before: None,
            after: RowState::Executable(expected_executable()),
            reason: "judging commit".to_string(),
        },
    ];
    assert_eq!(write.audit, expected_audit);
}

#[test]
fn a_failed_compilation_only_increments_compilation_tries() {
    let write = mapped(&compilation_body(false), Some(prior_result()));
    let mut expected = prior_row();
    expected.compilation_tries = 3;

    assert_eq!(write.result, expected);
    assert!(write.executables.is_empty());
    assert!(write.evaluations.is_empty());
    assert!(write.score.is_none());
    assert_eq!(
        write.audit,
        vec![AuditRow {
            actor_id: None,
            verb: "submissionresult:update".to_string(),
            entity: "submission_results".to_string(),
            entity_id: "41/9".to_string(),
            before: Some(RowState::Result(prior_row())),
            after: RowState::Result(expected),
            reason: "judging commit".to_string(),
        }]
    );
}

#[test]
fn a_compilation_writes_no_score_even_with_a_scored_predecessor() {
    assert!(prior_result().score.is_some());
    assert!(mapped(&compilation_body(true), Some(prior_result()))
        .score
        .is_none());
    assert!(mapped(&compilation_body(false), Some(prior_result()))
        .score
        .is_none());
}
