//! The loop a request goes through, with the jobs it runs scripted and the clock
//! it is charged to decided.
//!
//! Nothing is launched and no transport carries anything: a job's work is a
//! closure over the job's own body, and a request is charged between two clock
//! readings a test filled in. What these tests pin is the order the jobs of a
//! group are run in, the stamp each of them carries out, and the shape of a
//! group that a single job could not finish.

use cms_worker::edge::{JobError, JobResult};
use cms_worker::service::{GroupOutcome, Service, ServiceError, ServiceState};
use serde_json::{Map, Value};

#[path = "service_helpers.rs"]
mod helpers;

use helpers::{job, worker, Clock, KNOWN, NAME, SHARD};

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
