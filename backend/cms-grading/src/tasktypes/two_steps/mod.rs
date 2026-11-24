#![deny(missing_docs)]
#![forbid(unsafe_code)]

mod boxes;
mod compile;
mod launch;
mod pipes;
mod verdict;

use std::fs;
use std::path::Path;

use serde_json::Value;

use crate::job::EvaluationJob;
use crate::stage::{Cache, StageError};
use cms_sandbox::Launch;

use super::judge::{self, OutputSource, CHECKER_CODENAME};
use super::{Evaluation, Parameter, Parameters, Run, Runtime, Shared, TaskError, Toolchain};

const INPUT: &str = "input.txt";
const OUTPUT: &str = "output.txt";
const PIPE_MOUNT: &str = "/fifo";
const PIPE_NAME: &str = "fifo";
const OUTPUT_EVAL_COMPARATOR: &str = "comparator";
const OUTPUT_EVAL_DIFF: &str = "diff";
const EXECUTABLES_REQUIRED: usize = 1;

/// The one parameter this task type declares: how the second phase's answer is compared.
const EVALUATION: Parameter = Parameter::choice(
    "Output evaluation",
    "output_eval",
    "",
    &[OUTPUT_EVAL_DIFF, OUTPUT_EVAL_COMPARATOR],
);
/// The one parameter a task type of this kind is configured with.
static PARAMETERS: [Parameter; 1] = [EVALUATION];

struct Phase {
    name: &'static str,
    step: &'static str,
    input: Option<&'static str>,
    answer: Option<&'static str>,
}

const FIRST: Phase = Phase {
    name: "first_evaluate",
    step: "0",
    input: Some(INPUT),
    answer: None,
};
const SECOND: Phase = Phase {
    name: "second_evaluate",
    step: "1",
    input: None,
    answer: Some(OUTPUT),
};

/// The Two Steps task type, as its one parameter says.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TwoSteps {
    output_eval: String,
}

impl TwoSteps {
    /// Refuses malformed parameters before either phase is opened.
    pub fn new(parameters: &Value) -> Result<Self, TaskError> {
        let parameters = Parameters::of(parameters, &PARAMETERS)?;
        Ok(Self {
            output_eval: parameters.text(0).into_owned(),
        })
    }

    #[must_use]
    /// Selects a dataset checker instead of a plain whitespace-folded diff.
    pub fn uses_comparator(&self) -> bool {
        self.output_eval == OUTPUT_EVAL_COMPARATOR
    }

    /// Starts both phases before waiting so the pipe always has a reader and writer.
    pub fn evaluate(
        &self,
        job: &EvaluationJob,
        toolchain: &dyn Toolchain,
        runtime: &Runtime,
        store: Box<dyn Cache>,
    ) -> Result<Evaluation, TaskError> {
        let (executable, digest) = one_executable(job)?;
        let store = Shared::of(store);
        let pipe = pipes::pipe_dir(runtime.temp_dir())?;
        let mut first =
            boxes::open_phase(runtime, &store, &FIRST, &executable, &digest, &job.input)?;
        let mut second =
            boxes::open_phase(runtime, &store, &SECOND, &executable, &digest, &job.input)?;
        let one = launch::start(
            &mut first,
            job,
            toolchain,
            runtime,
            &executable,
            &pipe,
            &FIRST,
        )?;
        let two = launch::start(
            &mut second,
            job,
            toolchain,
            runtime,
            &executable,
            &pipe,
            &SECOND,
        )?;
        let checker = self.uses_comparator().then_some(CHECKER_CODENAME);
        finish(
            [first, second],
            [one, two],
            job,
            runtime,
            &store,
            checker,
            &pipe,
        )
    }
}

fn finish(
    [first, second]: [Run; 2],
    [one, two]: [Launch; 2],
    job: &EvaluationJob,
    runtime: &Runtime,
    store: &Shared,
    checker: Option<&'static str>,
    pipe: &Path,
) -> Result<Evaluation, TaskError> {
    let (one_stats, two_stats) = (
        one.wait().map_err(TaskError::Spawn)?,
        two.wait().map_err(TaskError::Spawn)?,
    );
    let mut evaluation = verdict::decide(&one_stats, &two_stats);
    if evaluation.success {
        verdict::judge(&mut evaluation, &second, job)?;
    }
    let judged = evaluation
        .output_file
        .clone()
        .map(|answer| {
            judge::eval_output(
                job,
                checker,
                OutputSource::Path(answer.path),
                OUTPUT,
                &[],
                runtime,
                store.arc(),
            )
        })
        .transpose()?;
    let judged_ok = judged
        .as_ref()
        .map_or(evaluation.success, |judged| judged.success);
    let keep = job.archive_sandbox || !judged_ok;
    for closed in [
        first.close(keep, job.archive_sandbox)?,
        second.close(keep, job.archive_sandbox)?,
    ] {
        closed.record(&mut evaluation.sandboxes, &mut evaluation.sandbox_digests);
    }
    if let Some(judged) = judged {
        evaluation.absorb(judged);
    }
    if !keep {
        let gone = fs::remove_dir_all(pipe);
        gone.map_err(|source| TaskError::Stage(StageError::io(pipe, &source)))?;
    }
    Ok(evaluation)
}

fn one_executable(job: &EvaluationJob) -> Result<(String, String), TaskError> {
    let unexpected = || TaskError::UnexpectedExecutables {
        found: job.executables.len(),
        wanted: EXECUTABLES_REQUIRED,
    };
    if job.executables.len() != EXECUTABLES_REQUIRED {
        return Err(unexpected());
    }
    let (name, digest) = job.executables.iter().next().ok_or_else(unexpected)?;
    Ok((name.clone(), digest.clone()))
}
