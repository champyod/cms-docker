//! One worker held and released: a request that finds it free, and one that finds
//! it already held.
//!
//! The threaded test is a rendezvous through two channels rather than a race, so
//! what it pins is the decline and not the order two threads happened to reach
//! the worker in.

use std::sync::mpsc;
use std::sync::Arc;
use std::thread;

use cms_worker::edge::JobResult;
use cms_worker::service::{GroupOutcome, Service, ServiceError, ServiceState};
use serde_json::{Map, Value};

#[path = "service_helpers.rs"]
mod helpers;

use helpers::{job, worker, Clock, SHARD};

#[test]
fn a_worker_taken_by_one_request_is_free_for_the_next() {
    let service = worker();
    let mut first = vec![job("first")];
    let first_clock = Clock::of(&[10.0, 12.0]);
    service
        .execute_group(&mut first, || first_clock.read(), |_, _| Ok(()))
        .expect("the first request takes the worker");
    let mut second = vec![job("second")];
    let second_clock = Clock::of(&[20.0, 21.0]);
    let outcome = service
        .execute_group(&mut second, || second_clock.read(), |_, _| Ok(()))
        .expect("the worker is released, so the next request is taken");
    assert_eq!(outcome.results, [JobResult::COMPLETED]);
    assert_eq!(outcome.report.busy_seconds, 1.0);
    assert_eq!(
        outcome.report.free_seconds, 8.0,
        "the worker was idle from 12.0 to 20.0"
    );
}

/// One request parked inside its only job while it holds the worker, and the
/// signal that lets it finish.
struct HeldRequest {
    finish: mpsc::Sender<()>,
    running: thread::JoinHandle<Result<GroupOutcome, ServiceError>>,
}

/// Starts a request that takes the worker and parks inside its one job until
/// [`HeldRequest::finish`] is sent, so a request arriving then finds a worker
/// already taken rather than a free one.
fn request_holding_the_worker(service: &Arc<Service>) -> HeldRequest {
    let (running, is_running) = mpsc::channel();
    let (finish, may_finish) = mpsc::channel();
    let holding = Arc::clone(service);
    let parked = thread::spawn(move || {
        let mut jobs = vec![job("only")];
        let clock = Clock::of(&[10.0, 12.0]);
        let mut work = |_task_type: &str, _body: &mut Map<String, Value>| {
            running.send(()).expect("the request is running");
            may_finish.recv().expect("the request may finish");
            Ok(())
        };
        holding.execute_group(&mut jobs, || clock.read(), &mut work)
    });
    is_running
        .recv()
        .expect("the first request took the worker and is running");
    HeldRequest {
        finish,
        running: parked,
    }
}

/// Asserts the refusal a request gets from a worker another request already
/// holds: it names that worker, and it charges the declined request for the idle
/// it waited in.
fn assert_declined(declined: ServiceError) {
    assert!(
        declined.to_string().contains("shard 3"),
        "the refusal names the worker that declined it: {declined}"
    );
    match declined {
        ServiceError::Declined { shard, report } => {
            assert_eq!(shard, SHARD);
            assert_eq!(
                report.busy_seconds, 1.0,
                "a request that ran nothing is still charged for what it took"
            );
            assert_eq!(report.free_seconds, 0.0, "no gap before the first");
        }
        refusal => panic!("a busy worker declines rather than refuses a job: {refusal}"),
    }
}

#[test]
fn a_request_that_finds_the_worker_busy_is_declined_and_still_charged() {
    let service = Arc::new(worker());
    let held = request_holding_the_worker(&service);
    assert_eq!(service.state(), ServiceState::Busy);

    let clock = Clock::of(&[25.0, 26.0]);
    let declined = service
        .execute_group(&mut [], || clock.read(), |_, _| Ok(()))
        .expect_err("a request that finds the worker busy is declined");
    assert_declined(declined);

    held.finish.send(()).expect("the first request may finish");
    let outcome = held.running.join().expect("the first request finished");
    let ran = outcome.expect("the first request ran its job");
    assert_eq!(ran.results, [JobResult::COMPLETED]);
    assert_eq!(service.state(), ServiceState::Free);
}
