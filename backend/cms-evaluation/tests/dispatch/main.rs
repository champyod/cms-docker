//! The synchronous per-shard dispatcher driven against real `cms-svc` hosts.

mod host;

use std::error::Error;

use cms_evaluation::{DispatchError, WorkerDispatcher};
use cms_proto::JobGroup;
use cms_svc::ClientError;
use serde_json::{json, Value};

use crate::host::{Reply, TestHost, SECRET};

/// Two opaque job bodies sent in one group.
fn two_jobs() -> Vec<Value> {
    vec![
        json!({ "type": "compilation", "id": 1 }),
        json!({ "type": "evaluation", "id": 2 }),
    ]
}

/// Checks every rendering of an error, including its source chain, for a leak.
fn assert_no_secret(error: &DispatchError) {
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

#[test]
fn dispatch_returns_the_exact_group_twice_on_one_dispatcher() {
    let host = TestHost::start(Reply::Same, Some(SECRET));
    let mut dispatcher = WorkerDispatcher::new(vec![host.addr()], Some(SECRET.to_owned()));
    let jobs = two_jobs();

    let first = dispatcher
        .dispatch(0, jobs.clone())
        .expect("the first dispatch succeeds");
    assert_eq!(first, JobGroup { jobs: jobs.clone() });
    let second = dispatcher
        .dispatch(0, jobs.clone())
        .expect("the second dispatch succeeds on the same client");
    assert_eq!(second, JobGroup { jobs });
    assert_eq!(host.hits(), 2);
}

#[test]
fn a_short_reply_is_a_count_mismatch() {
    let host = TestHost::start(Reply::Empty, Some(SECRET));
    let mut dispatcher = WorkerDispatcher::new(vec![host.addr()], Some(SECRET.to_owned()));

    let error = dispatcher
        .dispatch(0, two_jobs())
        .expect_err("an empty reply is refused");
    assert_no_secret(&error);
    match error {
        DispatchError::CountMismatch { sent, received } => {
            assert_eq!(sent, 2);
            assert_eq!(received, 0);
        }
        other => panic!("expected CountMismatch, got {other:?}"),
    }
    assert_eq!(host.hits(), 1);
}

#[test]
fn a_non_array_reply_is_a_response_refusal() {
    let host = TestHost::start(Reply::NotArray, Some(SECRET));
    let mut dispatcher = WorkerDispatcher::new(vec![host.addr()], Some(SECRET.to_owned()));

    let error = dispatcher
        .dispatch(0, two_jobs())
        .expect_err("a non-array jobs value is refused");
    assert_no_secret(&error);
    match &error {
        DispatchError::Response(_) => {}
        other => panic!("expected Response, got {other:?}"),
    }
    assert_eq!(host.hits(), 1);
}

#[test]
fn an_out_of_range_shard_is_no_worker_and_calls_no_host() {
    let host = TestHost::start(Reply::Same, Some(SECRET));
    let mut dispatcher = WorkerDispatcher::new(vec![host.addr()], Some(SECRET.to_owned()));

    let error = dispatcher
        .dispatch(3, two_jobs())
        .expect_err("an out-of-range shard is refused");
    assert_no_secret(&error);
    match error {
        DispatchError::NoWorker { shard } => assert_eq!(shard, 3),
        other => panic!("expected NoWorker, got {other:?}"),
    }
    assert_eq!(host.hits(), 0);
}

#[test]
fn a_refusing_worker_yields_client_refused() {
    let host = TestHost::start(Reply::Refuse, Some(SECRET));
    let mut dispatcher = WorkerDispatcher::new(vec![host.addr()], Some(SECRET.to_owned()));

    let error = dispatcher
        .dispatch(0, two_jobs())
        .expect_err("a refusing worker is reported");
    assert_no_secret(&error);
    match &error {
        DispatchError::Client(ClientError::Refused(_)) => {}
        other => panic!("expected Client(Refused), got {other:?}"),
    }
    assert_eq!(host.hits(), 1);
}
