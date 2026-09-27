//! The loop a request goes through, with the jobs it runs scripted and the clock
//! it is charged to decided.
//!
//! Nothing is launched and no transport carries anything: a job's work is a
//! closure over the job's own body, and a request is charged between two clock
//! readings a test filled in. The threaded test is a rendezvous through two
//! channels rather than a race, so what it pins is the decline and not the order
//! two threads happened to reach the worker in.

use std::cell::RefCell;
use std::collections::VecDeque;
use std::sync::mpsc;
use std::sync::Arc;
use std::thread;

use cms_proto::Shard;
use cms_worker::edge::{JobError, JobResult};
use cms_worker::service::{GroupOutcome, Job, Service, ServiceError, ServiceState};
use serde_json::{Map, Value};

/// The shard the worker under test stamps on the jobs it runs.
const SHARD: Shard = Shard::new(3);

/// The one task type the worker under test is configured with.
const KNOWN: &str = "batch";

/// The key a scripted job body is named under, which is how the work of one job
/// tells itself apart from the work of another.
const NAME: &str = "name";

/// A clock a test decided, handing out one reading per call, in order.
struct Clock {
    readings: RefCell<VecDeque<f64>>,
}

impl Clock {
    /// A clock that answers with those readings and then refuses, so a test
    /// cannot pass by reading the clock more times than it planned.
    fn of(readings: &[f64]) -> Self {
        let queue = RefCell::new(readings.iter().copied().collect());
        Self { readings: queue }
    }

    /// The next reading the test decided.
    fn read(&self) -> f64 {
        self.readings
            .borrow_mut()
            .pop_front()
            .expect("one reading per call of the clock")
    }
}

/// A worker of [`SHARD`], configured with the one task type [`KNOWN`].
fn worker() -> Service {
    Service::new(SHARD, vec![String::from(KNOWN)])
}

/// A job of that task type, whose body names it so its work can tell it apart
/// from the work of the other jobs of the same group.
fn job(name: &str) -> Job {
    let mut body = Map::new();
    body.insert(String::from(NAME), Value::from(name));
    let task_type = String::from(KNOWN);
    Job { task_type, body }
}

#[test]
fn a_group_runs_its_jobs_in_order_and_reports_each_of_them() {
    let service = worker();
    let mut jobs = vec![job("first"), job("second")];
    let clock = Clock::of(&[10.0, 14.0]);
    let mut ran: Vec<String> = Vec::new();
    let mut work = |task_type: &str, body: &mut Map<String, Value>| {
        ran.push(String::from(task_type));
        body.insert(String::from("ran"), Value::Bool(true));
        Ok(())
    };
    let outcome = service
        .execute_group(&mut jobs, || clock.read(), &mut work)
        .expect("a free worker takes the group");
    assert_eq!(ran, [KNOWN, KNOWN], "each job runs by its own task type");
    assert_eq!(outcome.results, [JobResult::COMPLETED; 2]);
    assert_eq!(outcome.report.busy_seconds, 4.0, "14.0 minus 10.0");
    assert!(jobs[1].body.contains_key("ran"), "what the task type wrote");
    assert_eq!(service.state(), ServiceState::Free);
}

#[test]
fn every_job_is_stamped_with_the_shard_before_it_is_dispatched() {
    let service = worker();
    let mut jobs = vec![job("only")];
    let clock = Clock::of(&[1.0, 2.0]);
    let mut stamped: Vec<Value> = Vec::new();
    let mut work = |_task_type: &str, body: &mut Map<String, Value>| {
        let stamp = body.get("shard").expect("the stamp is written first");
        stamped.push(stamp.clone());
        Ok(())
    };
    service
        .execute_group(&mut jobs, || clock.read(), &mut work)
        .expect("a free worker takes the group");
    assert_eq!(stamped, [Value::from(SHARD.get())]);
    assert_eq!(jobs[0].body.get("shard"), Some(&Value::from(3)));
}

#[test]
fn a_job_the_tombstone_stopped_is_one_result_and_the_group_continues() {
    let service = worker();
    let mut jobs = vec![job("gone"), job("kept")];
    let clock = Clock::of(&[5.0, 9.0]);
    let mut work = |_task_type: &str, body: &mut Map<String, Value>| {
        if body.get(NAME).and_then(Value::as_str) == Some("gone") {
            return Err(JobError::Tombstone);
        }
        Ok(())
    };
    let outcome = service
        .execute_group(&mut jobs, || clock.read(), &mut work)
        .expect("the tombstone is one job's result, not a failed group");
    assert_eq!(
        outcome.results,
        [JobResult::REFUSED_BY_TOMBSTONE, JobResult::COMPLETED],
        "the job after the refused one still runs"
    );
}

/// What the request that follows a released worker is charged, which is how the
/// charge of the request that failed before it is read back.
fn next_request_is_charged(service: &Service) -> GroupOutcome {
    let next_clock = Clock::of(&[20.0, 21.0]);
    let mut next = vec![job("after")];
    service
        .execute_group(&mut next, || next_clock.read(), |_, _| Ok(()))
        .expect("the worker is free, so the next request is taken")
}

#[test]
fn a_task_type_this_worker_does_not_have_fails_the_group_before_it_runs() {
    let service = worker();
    let mut jobs = vec![job("runs"), job("unknown")];
    jobs[1].task_type = String::from("minimax");
    let clock = Clock::of(&[5.0, 6.0]);
    let mut dispatched = 0;
    let mut work = |_task_type: &str, _body: &mut Map<String, Value>| {
        dispatched += 1;
        Ok(())
    };
    let refused = service
        .execute_group(&mut jobs, || clock.read(), &mut work)
        .expect_err("a task type the worker does not have is raised");
    assert_eq!(
        refused,
        ServiceError::Job(JobError::UnknownTaskType {
            name: String::from("minimax"),
        })
    );
    assert_eq!(dispatched, 1, "the first job ran, the second never did");
    assert_eq!(
        jobs[1].body.get("shard"),
        Some(&Value::from(3)),
        "a job is stamped before its task type is looked up"
    );
    assert_eq!(
        service.state(),
        ServiceState::Free,
        "the worker is released on the failing path too"
    );

    let next = next_request_is_charged(&service);
    assert_eq!(
        next.report.free_seconds, 14.0,
        "the request that failed its job was closed at 6.0 as well"
    );
}

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
