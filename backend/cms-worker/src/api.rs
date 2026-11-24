//! The RPC surface one worker answers, without a host to carry it.
//!
//! [`execute_job_group`] is the reference's method over the loop in
//! [`service`](crate::service): decode the group, stamp and run each job through
//! the typed runner, and return the same bodies in the same order. A tombstone
//! is written back as one unsuccessful job with its marker; every other job
//! refusal fails the group, while a worker already running a group declines the
//! request with the reference's own sentence.
//!
//! [`Worker::methods`] composes that method onto the base RPC table, so `echo`
//! and `quit` remain available wherever this table is handed to a host. Binding
//! a socket and parsing an environment belong to the composition root, not to
//! this module.
//!
//! # Errors
//!
//! A malformed envelope is refused by deserialization. A declined request and a
//! failed job group are returned as the two sentences the Python worker raises;
//! neither exposes a Rust debug representation.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::time::{SystemTime, UNIX_EPOCH};

use cms_proto::{JobGroup, JobKey, Method, Shard};
use serde_json::{json, Map, Value};

use crate::edge::JobResult;
use crate::precache::Precache;
use crate::run::Runner;
use crate::service::{Job, Service, ServiceError};

#[cfg(test)]
mod tests;

/// The name the worker's group method is served under.
const EXECUTE_JOB_GROUP_METHOD: &str = "execute_job_group";

/// The name the worker's contest-precache method is served under.
const PRECACHE_FILES_METHOD: &str = "precache_files";

/// The only argument the contest-precache method reads.
const CONTEST_ID_ARGUMENT: &str = "contest_id";

/// Said when a worker was built without a database URL.
const PRECACHE_UNAVAILABLE: &str = "precache_files() is unavailable because DATABASE_URL is unset";

/// The only key in a job-group envelope.
const JOBS_KEY: &str = "jobs";

/// The marker that says a job's needed content is gone.
const TOMBSTONE_MARKER: &str = "tombstone";

/// The prefix of every job failure the reference raises.
const WORKER_FAILED_PREFIX: &str = "Worker failed: ";

/// The exact sentence a worker already running a group answers with.
const BUSY_REFUSAL: &str = concat!(
    "Request received, but declined because of acquired lock ",
    "(Worker is busy executing another job, this should not happen: ",
    "check if there are more than one ES running, or for bugs in ES."
);

/// One worker: the loop that serializes its requests and the runner that does
/// each job's typed work.
#[derive(Debug)]
pub struct Worker {
    service: Service,
    runner: Runner,
    precache: Option<Precache>,
}

impl Worker {
    /// A worker of `shard`, configured with `task_types`, over `runner`.
    #[must_use]
    pub fn new(shard: Shard, task_types: Vec<String>, runner: Runner) -> Self {
        Self {
            service: Service::new(shard, task_types),
            runner,
            precache: None,
        }
    }

    /// Adds database-backed contest precaching to this worker.
    #[must_use]
    pub fn with_precache(mut self, precache: Precache) -> Self {
        self.precache = Some(precache);
        self
    }

    /// The methods this worker answers, with the base methods first.
    #[must_use]
    pub fn methods() -> Vec<Method<Self>> {
        let mut methods = cms_svc::service::methods::<Self>();
        methods.push(Method {
            name: EXECUTE_JOB_GROUP_METHOD,
            is_callable: true,
            handler: execute_job_group,
        });
        methods.push(Method {
            name: PRECACHE_FILES_METHOD,
            is_callable: true,
            handler: precache_files,
        });
        methods
    }
}

/// Precaches one contest's files and answers the reference's null result.
///
/// # Errors
///
/// Refuses a missing or malformed `contest_id`, a worker built without
/// [`PRECACHE_UNAVAILABLE`], or a database or cache refusal from [`Precache::run`].
pub fn precache_files(data: &Value, worker: &Worker) -> Result<Value, String> {
    let contest_id = data
        .get(CONTEST_ID_ARGUMENT)
        .and_then(Value::as_i64)
        .and_then(|value| i32::try_from(value).ok())
        .ok_or_else(|| {
            format!("{PRECACHE_FILES_METHOD}() requires an integer `{CONTEST_ID_ARGUMENT}`")
        })?;
    let precache = worker.precache.as_ref().ok_or(PRECACHE_UNAVAILABLE)?;
    precache.run(contest_id)?;
    Ok(Value::Null)
}

/// Runs one job group and returns its bodies with the results written into them.
///
/// # Errors
///
/// The deserializer's sentence for a malformed envelope, [`BUSY_REFUSAL`] when
/// another request holds the worker, or `Worker failed: ...` when a job refuses
/// for any reason but the tombstone.
pub fn execute_job_group(data: &Value, worker: &Worker) -> Result<Value, String> {
    let group: JobGroup =
        serde_json::from_value(data.clone()).map_err(|error| error.to_string())?;
    let mut jobs = decode_jobs(group.jobs)?;
    let outcome = worker
        .service
        .execute_group(&mut jobs, system_clock, |task_type, body| {
            worker.runner.run(task_type, body)
        })
        .map_err(refusal_sentence)?;
    write_tombstones(&mut jobs, &outcome.results);
    Ok(group_response(jobs))
}

/// Turns the group's opaque job values into the loop's stamped jobs.
fn decode_jobs(values: Vec<Value>) -> Result<Vec<Job>, String> {
    values
        .into_iter()
        .enumerate()
        .map(|(index, value)| {
            let Value::Object(body) = value else {
                return Err(format!("job {index} is not a JSON object"));
            };
            let task_type = body
                .get(JobKey::TASK_TYPE.as_str())
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    format!("job {index} has no string `{}`", JobKey::TASK_TYPE.as_str())
                })?;
            Ok(Job {
                task_type: task_type.to_owned(),
                body,
            })
        })
        .collect()
}

/// Writes the reference's two flags into each job the tombstone stopped.
fn write_tombstones(jobs: &mut [Job], results: &[JobResult]) {
    debug_assert_eq!(jobs.len(), results.len());
    for (job, result) in jobs.iter_mut().zip(results) {
        if result.tombstone {
            job.body
                .insert(JobKey::SUCCESS.as_str().to_owned(), json!(false));
            job.body.insert(
                JobKey::PLUS.as_str().to_owned(),
                json!({ TOMBSTONE_MARKER: true }),
            );
        }
    }
}

/// Returns the mutated bodies under the group's one envelope key.
fn group_response(jobs: Vec<Job>) -> Value {
    let bodies = jobs
        .into_iter()
        .map(|job| Value::Object(job.body))
        .collect();
    let mut response = Map::new();
    response.insert(JOBS_KEY.to_owned(), Value::Array(bodies));
    Value::Object(response)
}

/// Translates a loop refusal into the sentence the reference raises.
fn refusal_sentence(refusal: ServiceError) -> String {
    match refusal {
        ServiceError::Declined { .. } => BUSY_REFUSAL.to_owned(),
        ServiceError::Job(refusal) => format!("{WORKER_FAILED_PREFIX}{refusal}."),
    }
}

/// The wall-clock seconds the request loop is charged against.
fn system_clock() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("the system clock reads after the epoch")
        .as_secs_f64()
}
