//! Composes one submission job build, one shard dispatch and the strict
//! reading of every worker body that comes back.
//!
//! [`run_submission`] is the whole of the composition: it builds exactly one
//! worker body, sends that one job to one shard, then reads each returned body
//! as a JSON object and a [`WorkerOutput`] in the order the worker returned
//! them. It does not read the database, retry, group results or write anything.

use std::fmt;

use cms_db::SubmissionInputs;
use cms_proto::Operation;
use serde_json::{Map, Value};

use crate::dispatch::{DispatchError, WorkerDispatcher};
use crate::job::{submission_job, SubmissionJobError};
use crate::result::{worker_output, WorkerOutput, WorkerOutputError};

/// Why one submission did not yield a set of storable outputs.
///
/// The four cases stay distinct so a caller can tell a refused build, a failed
/// dispatch, a returned body that is not a JSON object and a body whose result
/// keys are malformed apart. No variant carries the shared secret.
#[derive(Debug)]
pub enum RunnerError {
    /// The worker body could not be built from the bundle.
    Job(SubmissionJobError),
    /// The one job could not be dispatched to the shard.
    Dispatch(DispatchError),
    /// A returned job was not a JSON object.
    NonObjectBody,
    /// A returned object's result keys were malformed.
    Output(WorkerOutputError),
}

impl fmt::Display for RunnerError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Job(source) => write!(f, "cannot build the submission job: {source}"),
            Self::Dispatch(source) => write!(f, "cannot dispatch the submission job: {source}"),
            Self::NonObjectBody => write!(f, "a returned job body is not a JSON object"),
            Self::Output(source) => write!(f, "cannot read a returned job body: {source}"),
        }
    }
}

impl std::error::Error for RunnerError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Job(source) => Some(source),
            Self::Dispatch(source) => Some(source),
            Self::Output(source) => Some(source),
            Self::NonObjectBody => None,
        }
    }
}

/// Reads each returned job body into a [`WorkerOutput`], in returned order.
fn parse_bodies(jobs: &[Value]) -> Result<Vec<WorkerOutput>, RunnerError> {
    jobs.iter()
        .map(|job| {
            let object: &Map<String, Value> = job.as_object().ok_or(RunnerError::NonObjectBody)?;
            worker_output(object).map_err(RunnerError::Output)
        })
        .collect()
}

/// Builds one submission body, dispatches it to `shard`, and parses every
/// returned body into a [`WorkerOutput`] in the order it was returned.
///
/// # Errors
///
/// [`RunnerError::Job`] when the body cannot be built,
/// [`RunnerError::Dispatch`] when the shard dispatch fails,
/// [`RunnerError::NonObjectBody`] when a returned job is not an object, and
/// [`RunnerError::Output`] when a returned object's result keys are malformed.
pub fn run_submission(
    operation: &Operation,
    inputs: &SubmissionInputs,
    dispatcher: &mut WorkerDispatcher,
    shard: usize,
) -> Result<Vec<WorkerOutput>, RunnerError> {
    let body = submission_job(operation, inputs).map_err(RunnerError::Job)?;
    let group = dispatcher
        .dispatch(shard, vec![body])
        .map_err(RunnerError::Dispatch)?;
    parse_bodies(&group.jobs)
}
