//! The typed work one job asks a worker to do.
//!
//! The service around this module has already stamped the job's shard and
//! resolved the task type against the worker's configuration. What remains is
//! the wire body: [`JobKind::read`] selects its shape, the grading crate's
//! `from_body` reads that shape once, and the selected phase writes its result
//! back through the grading crate's own `write_body`. No field name or key set
//! is repeated here.
//!
//! A language is looked up only when the job names one, and the task type is
//! built from the parameters the typed job already carries. The runtime and
//! cache belong to the worker rather than to a request, so each phase receives
//! the same settings and a clone of the same filesystem store.
//!
//! The language lookup is deferred rather than raised: a known toolchain is
//! passed when there is one, and an unknown name is reported only if the selected
//! phase returns [`TaskError::NoLanguage`]. A phase that answers from a carried
//! file or skips compilation therefore never asks for a toolchain it does not
//! read, as the reference does.
//!
//! # Errors
//!
//! [`JobError`], and only that: a malformed wire body, an unknown language, bad
//! task parameters or any other refusal becomes [`JobError::Work`] with the
//! refusing layer's display sentence. The tombstone alone keeps its meaning as
//! [`JobError::Tombstone`], so the service can report it as one unsuccessful job
//! rather than fail the group.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::fmt;

use cms_grading::execute;
use cms_grading::job::{CompilationJob, EvaluationJob};
use cms_grading::languages::get_language;
use cms_grading::stage::{Cache, FsCache};
use cms_grading::tasktypes::{Runtime, TaskError, TaskType, Toolchain};
use cms_proto::JobKind;
use serde_json::{Map, Value};

use crate::edge::{from_task_error, JobError};

#[cfg(test)]
mod tests;

/// The machine and store every job of one worker shares.
#[derive(Debug, Clone)]
pub struct Runner {
    runtime: Runtime,
    cache: FsCache,
}

impl Runner {
    /// A runner over the worker's runtime and filesystem cache.
    #[must_use]
    pub const fn new(runtime: Runtime, cache: FsCache) -> Self {
        Self { runtime, cache }
    }

    /// Runs one stamped job and writes the typed phase's result into its body.
    ///
    /// # Errors
    ///
    /// [`JobError::Work`] for a malformed body, unknown language, bad parameters
    /// or any other refusal; [`JobError::Tombstone`] when a needed file is gone.
    pub fn run(&self, task_type_name: &str, body: &mut Map<String, Value>) -> Result<(), JobError> {
        run_job(
            task_type_name,
            body,
            &self.runtime,
            Box::new(self.cache.clone()),
        )
    }
}

/// Runs a job over the store a caller handed it, which is the worker's cloned
/// filesystem cache in production and a decided fake in the tests.
fn run_job(
    task_type_name: &str,
    body: &mut Map<String, Value>,
    runtime: &Runtime,
    store: Box<dyn Cache>,
) -> Result<(), JobError> {
    match JobKind::read(body).map_err(work)? {
        JobKind::Compilation => {
            run_compilation(task_type_name, body, runtime, store)?;
        }
        JobKind::Evaluation => {
            run_evaluation(task_type_name, body, runtime, store)?;
        }
    }
    Ok(())
}

/// Reads, compiles and writes one compilation body.
fn run_compilation(
    task_type_name: &str,
    body: &mut Map<String, Value>,
    runtime: &Runtime,
    store: Box<dyn Cache>,
) -> Result<(), JobError> {
    let job = CompilationJob::from_body(body).map_err(work)?;
    let task_type =
        TaskType::of(task_type_name, &job.task_type_parameters).map_err(from_task_error)?;
    let (toolchain, unknown_language) = lookup_language(job.language.as_deref());
    let result = execute::compile(&task_type, &job, toolchain, runtime, store)
        .map_err(|error| phase_refusal(error, unknown_language))?;
    result.write_body(body);
    Ok(())
}

/// Reads, evaluates and writes one evaluation body.
fn run_evaluation(
    task_type_name: &str,
    body: &mut Map<String, Value>,
    runtime: &Runtime,
    store: Box<dyn Cache>,
) -> Result<(), JobError> {
    let job = EvaluationJob::from_body(body).map_err(work)?;
    let task_type =
        TaskType::of(task_type_name, &job.task_type_parameters).map_err(from_task_error)?;
    let (toolchain, unknown_language) = lookup_language(job.language.as_deref());
    let result = execute::evaluate(&task_type, &job, toolchain, runtime, store)
        .map_err(|error| phase_refusal(error, unknown_language))?;
    result.write_body(body);
    Ok(())
}

/// The toolchain a job names, or none when the task takes no language.
///
/// The unknown-name sentence is returned beside it rather than raised because
/// only a phase that reaches a language step may refuse it.
fn lookup_language(name: Option<&str>) -> (Option<&'static dyn Toolchain>, Option<String>) {
    let Some(name) = name else {
        return (None, None);
    };
    match get_language(name) {
        Ok(toolchain) => (Some(toolchain), None),
        Err(error) => (None, Some(error.to_string())),
    }
}

/// Reports an unknown language only when the selected phase needed a toolchain.
fn phase_refusal(error: TaskError, unknown_language: Option<String>) -> JobError {
    if matches!(&error, TaskError::NoLanguage) {
        if let Some(reason) = unknown_language {
            return JobError::Work { reason };
        }
    }
    from_task_error(error)
}

/// Carries a refusal from the wire or language layer as work, not a tombstone.
fn work(error: impl fmt::Display) -> JobError {
    JobError::Work {
        reason: error.to_string(),
    }
}
