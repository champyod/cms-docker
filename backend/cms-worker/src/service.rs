//! The loop one worker runs a request through, and the state that keeps it to
//! one request at a time.
//!
//! `execute_job_group` is one method and its shape is the whole of this module:
//! the work lock is taken without waiting, and a lock already held declines the
//! request rather than queueing it — a decline means two services are pointed at
//! one worker, which is a fault to report and not a load to absorb. The jobs are
//! then run one at a time, each stamped with the shard that ran it and each
//! dispatched through [`dispose`], so a job the tombstone stopped is one result
//! of a group rather than a failed group. The request is charged to the worker's
//! clock and the worker released whichever way it left, declined one included.
//!
//! Two orderings are the reference's and are why the code is shaped this way. The
//! task type of a job is resolved before its work is dispatched, so a dataset
//! naming a task type this worker does not have fails the group instead of being
//! reported as one refused job. And the request is charged before the worker is
//! released, so what it cost is known before the next request is charged against
//! it. Being busy is a value, [`ServiceState`], and the hold that comes back from
//! taking the worker is what releases it, once and only once.
//!
//! # Errors
//!
//! [`ServiceError`], and only that: a request declined because the worker was
//! already running a group, which is still charged to the clock, and a job that
//! could not be run to the end, whose own refusal is [`JobError`].

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::fmt;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Mutex;

use cms_proto::Shard;
use serde_json::{Map, Value};

use crate::edge::{dispose, resolve_task_type, Accounting, BusyReport, JobError, JobResult};

/// The key a job's shard is written under, and the key its result is read back by.
const SHARD_KEY: &str = "shard";

/// The state of a worker no request holds.
const STATE_FREE: u8 = 0;

/// The state of a worker one request holds.
const STATE_BUSY: u8 = 1;

/// One job of a group, as the loop holds it: the object the task type reads and
/// writes, and the name of the task type that runs it.
#[derive(Debug, Clone, PartialEq)]
pub struct Job {
    /// The task type this job is run by, resolved against the worker's
    /// configuration before any of the job's work is dispatched.
    pub task_type: String,
    /// The job itself, stamped with the shard on the way in and carrying what the
    /// task type wrote on the way out.
    pub body: Map<String, Value>,
}

/// Whether the worker is running a job group or is free to take one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServiceState {
    /// No request holds the worker, so the next one is taken and run.
    Free,
    /// A request holds the worker and is running its jobs one by one, so a
    /// request arriving now is declined rather than queued behind it.
    Busy,
}

/// What one request produced: what each job is reported with, and what it cost.
#[derive(Debug, Clone, PartialEq)]
pub struct GroupOutcome {
    /// One result per job, in the order the jobs appeared in the group, so a job
    /// the tombstone stopped is a result of its own.
    pub results: Vec<JobResult>,
    /// What the request cost, closed against the same clock as every request the
    /// worker has served.
    pub report: BusyReport,
}

/// Why a request was not run.
#[derive(Debug, Clone, PartialEq)]
pub enum ServiceError {
    /// The worker was already running a job group, so the request is declined and
    /// not queued. The refusal names the worker that declined it, because a
    /// decline is two services pointed at one worker and the shard is which one.
    Declined {
        /// The worker that declined the request, which is the one that was busy.
        shard: Shard,
        /// What it cost: a refused request is still charged for the idle it waited in.
        report: BusyReport,
    },
    /// A job could not be run to the end, so the whole group is refused rather
    /// than one job of it reported as unsuccessful.
    Job(JobError),
}

impl fmt::Display for ServiceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Declined { shard, .. } => {
                write!(f, "declined while shard {} runs a group", shard.get())
            }
            Self::Job(refusal) => write!(f, "job group failed: {refusal}"),
        }
    }
}

impl std::error::Error for ServiceError {}

impl From<JobError> for ServiceError {
    fn from(refusal: JobError) -> Self {
        Self::Job(refusal)
    }
}

/// One worker: its shard, its task types, whether a request has it, and its cost.
#[derive(Debug)]
pub struct Service {
    shard: Shard,
    task_types: Vec<String>,
    state: AtomicU8,
    accounting: Mutex<Accounting>,
}

impl Service {
    /// A worker of that shard, configured with the task types it can run.
    #[must_use]
    pub fn new(shard: Shard, task_types: Vec<String>) -> Self {
        Self {
            shard,
            task_types,
            state: AtomicU8::new(STATE_FREE),
            accounting: Mutex::new(Accounting::new()),
        }
    }

    /// Whether the worker is running a job group or is free to take one, which a
    /// caller reads to see why a request of its own was declined.
    #[must_use]
    pub fn state(&self) -> ServiceState {
        match self.state.load(Ordering::Acquire) {
            STATE_FREE => ServiceState::Free,
            _ => ServiceState::Busy,
        }
    }

    /// Runs one group of jobs, or declines the request outright.
    ///
    /// `clock` is read twice, as the request arrives and as it is answered, which
    /// are the two readings [`Accounting::close`] charges. `work` is handed each
    /// job in turn with the task type the job resolved to, and writes what that
    /// task type produced into the job's own body.
    ///
    /// # Errors
    ///
    /// [`ServiceError::Declined`] when a request already holds the worker,
    /// carrying the worker that declined it and what the declined request cost.
    /// [`ServiceError::Job`] for the first job whose task type this worker does
    /// not have, or whose work refused for any reason but the tombstone.
    pub fn execute_group<C, F>(
        &self,
        jobs: &mut [Job],
        mut clock: C,
        mut work: F,
    ) -> Result<GroupOutcome, ServiceError>
    where
        C: FnMut() -> f64,
        F: FnMut(&str, &mut Map<String, Value>) -> Result<(), JobError>,
    {
        let start = clock();
        let hold = match try_hold(&self.state) {
            Some(taken) => taken,
            None => {
                let report = self.charge(start, clock());
                return Err(ServiceError::Declined {
                    shard: self.shard,
                    report,
                });
            }
        };
        let ran = self.run(jobs, &mut work);
        let report = self.charge(start, clock());
        drop(hold);
        ran.map(|results| GroupOutcome { results, report })
    }

    /// Runs each job of a group in turn and collects what each is reported with.
    /// The first job that could not be run to the end ends the group, as the
    /// reference ends it: the results before it are lost with it.
    fn run<F>(&self, jobs: &mut [Job], work: &mut F) -> Result<Vec<JobResult>, ServiceError>
    where
        F: FnMut(&str, &mut Map<String, Value>) -> Result<(), JobError>,
    {
        let mut results = Vec::with_capacity(jobs.len());
        for job in jobs.iter_mut() {
            results.push(self.run_one(job, work)?);
        }
        Ok(results)
    }

    /// Stamps one job with the shard, resolves the task type that runs it, and
    /// dispatches it through the disposal that turns a refusal into a result.
    fn run_one<F>(&self, job: &mut Job, work: &mut F) -> Result<JobResult, ServiceError>
    where
        F: FnMut(&str, &mut Map<String, Value>) -> Result<(), JobError>,
    {
        job.body
            .insert(String::from(SHARD_KEY), Value::from(self.shard.get()));
        let task_type = resolve_task_type(&job.task_type, &self.task_types)?;
        dispose(|| work(task_type, &mut job.body)).map_err(ServiceError::from)
    }

    /// Closes one request against the worker's clock, from the reading taken as
    /// it arrived to the one taken now, and is called on every path out of the
    /// loop. What the lock guards is four numbers, so a panic in one thread left
    /// them readable rather than inconsistent, and this recovers them.
    fn charge(&self, start: f64, end: f64) -> BusyReport {
        let mut accounting = self
            .accounting
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        accounting.close(start, end)
    }
}

/// Takes a worker that is free, and holds it for as long as the hold is alive.
/// Nothing is queued: a worker already held is a request declined, not a wait.
fn try_hold(state: &AtomicU8) -> Option<Holding<'_>> {
    let taken = state
        .compare_exchange(STATE_FREE, STATE_BUSY, Ordering::AcqRel, Ordering::Acquire)
        .is_ok();
    taken.then_some(Holding { state })
}

/// The hold one request has on a worker, which ends when it is dropped.
///
/// Dropping is the only way out of a hold, so the worker is released exactly once
/// on every path: none releases early and then falls out of the scope as well.
#[derive(Debug)]
struct Holding<'a> {
    state: &'a AtomicU8,
}

impl Drop for Holding<'_> {
    fn drop(&mut self) {
        self.state.store(STATE_FREE, Ordering::Release);
    }
}
