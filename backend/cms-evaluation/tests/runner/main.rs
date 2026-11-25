//! The submission runner composed against real `cms-svc` hosts.
//!
//! Every host started here is stopped and joined on drop. No test is skipped.

pub mod host;
pub mod support;

use std::error::Error;

use cms_evaluation::{
    run_submission, DispatchError, RunStats, RunnerError, SubmissionJobError, WorkerDispatcher,
    WorkerOutput, WorkerOutputError,
};
use cms_proto::OperationKind;

use crate::host::{Reply, TestHost, SECRET};
use crate::support::ValidFixture;

/// None of the runner's error renderings may expose the shared secret.
fn assert_no_secret(error: &RunnerError) {
    let mut current: Option<&(dyn Error + 'static)> = Some(error);
    while let Some(item) = current {
        assert!(
            !format!("{item:?}").contains(SECRET),
            "the debug error leaked the secret"
        );
        assert!(
            !item.to_string().contains(SECRET),
            "the displayed error leaked the secret"
        );
        current = item.source();
    }
}

/// The `plus: {}` body yields stats with every figure absent.
fn empty_stats() -> RunStats {
    RunStats {
        execution_time: None,
        wall_clock_time: None,
        memory_bytes: None,
        stdout: None,
        stderr: None,
    }
}

/// One returned job must parse into one successful output in returned order.
fn assert_single_ok(outputs: &[WorkerOutput]) {
    assert_eq!(outputs.len(), 1, "one returned job yields one output");
    let output = &outputs[0];
    assert!(output.success, "the worker box itself worked");
    assert_eq!(
        output.text,
        Some(vec!["ok".to_owned()]),
        "the text keeps its order"
    );
    assert_eq!(
        output.stats,
        Some(empty_stats()),
        "plus empty object yields all-None stats"
    );
}

#[test]
fn a_compilation_is_built_dispatched_and_parsed_into_one_output() {
    let host = TestHost::start(Reply::Success, Some(SECRET));
    let mut dispatcher = WorkerDispatcher::new(vec![host.addr()], Some(SECRET.to_owned()));
    let outputs = run_submission(
        &ValidFixture::operation(OperationKind::Compilation, None),
        &ValidFixture::inputs(),
        &mut dispatcher,
        0,
    )
    .expect("a valid compilation run");
    assert_single_ok(&outputs);
    assert_eq!(host.hits(), 1, "exactly one dispatch reached the host");
}

#[test]
fn an_evaluation_is_built_dispatched_and_parsed_into_one_output() {
    let host = TestHost::start(Reply::Success, Some(SECRET));
    let mut dispatcher = WorkerDispatcher::new(vec![host.addr()], Some(SECRET.to_owned()));
    let outputs = run_submission(
        &ValidFixture::operation(OperationKind::Evaluation, Some("alpha")),
        &ValidFixture::inputs(),
        &mut dispatcher,
        0,
    )
    .expect("a valid evaluation run");
    assert_single_ok(&outputs);
    assert_eq!(host.hits(), 1, "exactly one dispatch reached the host");
}

#[test]
fn a_string_success_yields_an_output_error_naming_the_key() {
    let host = TestHost::start(Reply::StringSuccess, Some(SECRET));
    let mut dispatcher = WorkerDispatcher::new(vec![host.addr()], Some(SECRET.to_owned()));
    let error = run_submission(
        &ValidFixture::operation(OperationKind::Compilation, None),
        &ValidFixture::inputs(),
        &mut dispatcher,
        0,
    )
    .expect_err("a string success is refused");
    assert_no_secret(&error);
    match error {
        RunnerError::Output(WorkerOutputError::WrongType { key, .. }) => {
            assert_eq!(key, "success");
        }
        other => panic!("expected Output(WrongType), got {other:?}"),
    }
    assert_eq!(host.hits(), 1, "the dispatch precedes the parse refusal");
}

#[test]
fn invalid_parameters_are_a_job_error_and_call_no_host() {
    let host = TestHost::start(Reply::Success, Some(SECRET));
    let mut dispatcher = WorkerDispatcher::new(vec![host.addr()], Some(SECRET.to_owned()));
    let error = run_submission(
        &ValidFixture::operation(OperationKind::Compilation, None),
        &ValidFixture::invalid_inputs(),
        &mut dispatcher,
        0,
    )
    .expect_err("malformed parameters are refused");
    assert_no_secret(&error);
    match &error {
        RunnerError::Job(SubmissionJobError::MalformedDatasetParameters { .. }) => {}
        other => panic!("expected Job(MalformedDatasetParameters), got {other:?}"),
    }
    assert_eq!(host.hits(), 0, "the build refuses before any dispatch");
}

#[test]
fn an_empty_dispatcher_is_no_worker() {
    let mut dispatcher = WorkerDispatcher::new(vec![], Some(SECRET.to_owned()));
    let error = run_submission(
        &ValidFixture::operation(OperationKind::Compilation, None),
        &ValidFixture::inputs(),
        &mut dispatcher,
        0,
    )
    .expect_err("no shard is configured");
    assert_no_secret(&error);
    match error {
        RunnerError::Dispatch(DispatchError::NoWorker { shard }) => assert_eq!(shard, 0),
        other => panic!("expected Dispatch(NoWorker), got {other:?}"),
    }
}

#[test]
fn an_out_of_range_shard_is_no_worker_and_calls_no_host() {
    let host = TestHost::start(Reply::Success, Some(SECRET));
    let mut dispatcher = WorkerDispatcher::new(vec![host.addr()], Some(SECRET.to_owned()));
    let error = run_submission(
        &ValidFixture::operation(OperationKind::Compilation, None),
        &ValidFixture::inputs(),
        &mut dispatcher,
        3,
    )
    .expect_err("shard 3 has no worker");
    assert_no_secret(&error);
    match error {
        RunnerError::Dispatch(DispatchError::NoWorker { shard }) => assert_eq!(shard, 3),
        other => panic!("expected Dispatch(NoWorker), got {other:?}"),
    }
    assert_eq!(host.hits(), 0, "an out-of-range shard never connects");
}
