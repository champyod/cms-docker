//! Mapping a returned user-test body into the write the daemon commits.

use cms_db::{UserTestOperation, UserTestResult};
use cms_evaluation::{map_user_test_result, RunStats, WorkerOutput};
use cms_proto::OperationKind;

use crate::fixture::ValidFixture;

/// One compilation output with two produced executables and a shard.
fn output(success: bool) -> WorkerOutput {
    WorkerOutput {
        success,
        compilation_success: Some(success),
        outcome: None,
        text: Some(vec!["compiled".to_owned()]),
        admin_text: None,
        user_output: None,
        sandboxes: vec!["/tmp/a".to_owned()],
        sandbox_digests: Default::default(),
        executables: [("ut".to_owned(), ValidFixture::hex(0xf1))]
            .into_iter()
            .collect(),
        stats: Some(RunStats {
            execution_time: Some(1.5),
            wall_clock_time: Some(2.5),
            memory_bytes: Some(1024),
            stdout: Some("out".to_owned()),
            stderr: Some("err".to_owned()),
        }),
        shard: Some(3),
        tombstone: false,
    }
}

/// One stored result with its compilation half already written.
fn prior() -> UserTestResult {
    let mut result = UserTestResult::new(ValidFixture::USER_TEST_ID, ValidFixture::DATASET_ID);
    result.compilation_outcome = Some(cms_db::CompilationOutcome::Ok);
    result.compilation_tries = 2;
    result.compilation_text = vec!["earlier compile".to_owned()];
    result
}

#[test]
fn a_successful_compilation_maps_the_result_and_its_executable() {
    let write = map_user_test_result(
        &output(true),
        &ValidFixture::operation(OperationKind::UserTestCompilation),
        &ValidFixture::inputs(),
        None,
    )
    .expect("a valid compilation maps");
    assert_eq!(write.operation, UserTestOperation::Compilation);
    assert_eq!(write.result.compilation_outcome.as_deref(), Some("ok"));
    assert_eq!(write.result.compilation_tries, 0);
    assert_eq!(write.result.compilation_stdout.as_deref(), Some("out"));
    assert_eq!(write.result.compilation_shard, Some(3));
    assert_eq!(
        write.result.compilation_sandbox_paths,
        Some(vec!["/tmp/a".to_owned()])
    );
    assert_eq!(write.executables.len(), 1);
    assert_eq!(write.executables[0].filename.as_str(), "ut");
    assert_eq!(write.audit.len(), 2, "the result and the file are recorded");
}

#[test]
fn a_failed_compilation_keeps_the_prior_half_and_adds_a_try() {
    let write = map_user_test_result(
        &output(false),
        &ValidFixture::operation(OperationKind::UserTestCompilation),
        &ValidFixture::inputs(),
        Some(&prior()),
    )
    .expect("a failed compilation maps");
    assert_eq!(write.operation, UserTestOperation::Compilation);
    assert_eq!(write.result.compilation_tries, 3);
    assert_eq!(write.result.compilation_outcome.as_deref(), Some("ok"));
    assert!(
        write.executables.is_empty(),
        "no new executable was produced"
    );
    assert_eq!(write.audit.len(), 1);
    assert!(write.audit[0].before.is_some(), "the prior row is recorded");
    assert_eq!(write.audit[0].verb, "usertest:update");
}

#[test]
fn a_successful_evaluation_preserves_the_compilation_half() {
    let mut body = output(true);
    body.compilation_success = None;
    body.user_output = Some(ValidFixture::digest(0xa2));
    body.outcome = Some("ok".to_owned());
    let write = map_user_test_result(
        &body,
        &ValidFixture::operation(OperationKind::UserTestEvaluation),
        &ValidFixture::inputs(),
        Some(&prior()),
    )
    .expect("a valid evaluation maps");
    assert_eq!(write.operation, UserTestOperation::Evaluation);
    assert_eq!(write.result.compilation_outcome.as_deref(), Some("ok"));
    assert_eq!(write.result.compilation_tries, 2);
    assert_eq!(write.result.evaluation_outcome.as_deref(), Some("ok"));
    assert_eq!(write.result.output, Some(ValidFixture::digest(0xa2)));
    assert_eq!(write.result.execution_time, Some(1.5));
    assert_eq!(write.result.evaluation_shard, Some(3));
}

#[test]
fn a_failed_evaluation_increments_only_the_evaluation_tries() {
    let mut body = output(false);
    body.compilation_success = None;
    let write = map_user_test_result(
        &body,
        &ValidFixture::operation(OperationKind::UserTestEvaluation),
        &ValidFixture::inputs(),
        Some(&prior()),
    )
    .expect("a failed evaluation maps");
    assert_eq!(write.result.evaluation_tries, 1);
    assert_eq!(write.result.compilation_outcome.as_deref(), Some("ok"));
    assert_eq!(write.result.evaluation_outcome, None);
    assert!(write.executables.is_empty());
}

#[test]
fn a_wrong_object_id_is_refused() {
    let mut operation = ValidFixture::operation(OperationKind::UserTestCompilation);
    operation.object_id += 1;
    let error = map_user_test_result(&output(true), &operation, &ValidFixture::inputs(), None)
        .expect_err("another user test is refused");
    assert!(error.to_string().contains("object_id"), "{error}");
}

#[test]
fn a_submission_operation_is_refused() {
    let error = map_user_test_result(
        &output(true),
        &ValidFixture::operation(OperationKind::Compilation),
        &ValidFixture::inputs(),
        None,
    )
    .expect_err("a submission kind is refused");
    assert!(error.to_string().contains("unsupported"), "{error}");
}
