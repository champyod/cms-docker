//! The Two Steps task type: one program run twice, the first computing something the
//! second has to recover, the two talking through a single named pipe.
//!
//! The order is the reference's and the only one that works. The pipe's directory is
//! made before either box, because a box is handed it as a directory to make visible
//! and one that is not there cannot be made visible. Each box is handed the manager it
//! runs — the one executable a result holds — and only the first is handed the input.
//! Both runs are then started before either is waited for: the first writes down the
//! pipe and the second reads up it, so a first waited for before the second started
//! would wait for a reader that had not been started. What the two were charged is
//! then merged as one run's, for they were alive at once.
//!
//! The answer is read in the order the reference reads it: a box that did not work is
//! undecided, a stopped or killed run is told why, the second phase's answer is judged
//! on the file it was told to write, and a job that only asked to be run is answered
//! before any of that. What the answer is worth is left to the comparison, as a
//! [`Batch`](super::Batch) evaluation leaves its file to it.
//!
//! Each of those steps is one module's whole subject — [`pipes`] makes the directory
//! the two phases talk through, [`boxes`] opens the box of one phase and hands it the
//! manager it runs, [`launch`] starts each phase under the dataset's own limits, and
//! [`verdict`] reads what the two left behind.
//!
//! # Errors
//!
//! [`TaskError`], and only that: parameters that are not the one a Two Steps task has, a
//! result holding a number of executables other than one, a limit the dataset set that
//! is not a positive number, a directory or a named pipe that could not be made, a file
//! the store would not hand over, and a run the box could not carry or read back.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

mod boxes;
mod launch;
mod pipes;
mod verdict;

use std::fs;
use std::path::Path;
use std::sync::Arc;

use serde_json::Value;

use crate::job::EvaluationJob;
use crate::sandbox::Launch;
use crate::stage::{Cache, CacheHandle, FileDigest, StageError};

use super::{Evaluation, Run, Runtime, TaskError, Toolchain};

const INPUT: &str = "input.txt";
const OUTPUT: &str = "output.txt";
/// Where inside a box the pipe's directory is seen, and the name the pipe has inside
/// it, which is the name both phases are handed as their third argument.
const PIPE_MOUNT: &str = "/fifo";
const PIPE_NAME: &str = "fifo";
const OUTPUT_EVAL_COMPARATOR: &str = "comparator";
const EXECUTABLES_REQUIRED: usize = 1;

/// One phase: the box it runs in, the step its manager is told it is, the file it
/// reads from that box, and the file its answer is written to. Only the first phase
/// reads the input and only the second writes the answer.
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

/// The one store every box of an evaluation reads, shared rather than split: a `Box`
/// cannot be handed to two and the reference passes its file cacher to every sandbox.
#[derive(Clone)]
struct Shared(Arc<dyn Cache>);

impl Cache for Shared {
    fn get_file(&self, handle: &CacheHandle) -> Result<Vec<u8>, StageError> {
        self.0.get_file(handle)
    }

    fn put_file(&self, digest: &FileDigest, content: &[u8]) -> Result<bool, StageError> {
        self.0.put_file(digest, content)
    }
}

/// The Two Steps task type, as its one parameter says.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TwoSteps {
    output_eval: String,
}

impl TwoSteps {
    /// Reads the one parameter a Two Steps task type is configured with: whether the
    /// second phase's answer is compared with a white diff or by a comparator.
    ///
    /// # Errors
    ///
    /// [`TaskError::Parameters`] unless the parameters hold exactly one string.
    pub fn new(parameters: &Value) -> Result<Self, TaskError> {
        let entries = parameters.as_array().ok_or(TaskError::Parameters)?;
        let [output_eval] = entries.as_slice() else {
            return Err(TaskError::Parameters);
        };
        let output_eval = output_eval.as_str().ok_or(TaskError::Parameters)?;
        Ok(Self {
            output_eval: output_eval.to_owned(),
        })
    }

    /// Whether a comparator the dataset holds reads the second phase's answer, rather
    /// than the two files being diffed.
    #[must_use]
    pub fn uses_comparator(&self) -> bool {
        self.output_eval == OUTPUT_EVAL_COMPARATOR
    }

    /// Judges one submission on one testcase by running the manager twice, the first
    /// computing and the second recovering, both through one pipe.
    ///
    /// # Errors
    ///
    /// [`TaskError`], and only that: everything this module's own Errors section
    /// names, which is what each of the steps below refuses.
    pub fn evaluate(
        &self,
        job: &EvaluationJob,
        toolchain: &dyn Toolchain,
        runtime: &Runtime,
        store: Box<dyn Cache>,
    ) -> Result<Evaluation, TaskError> {
        let (executable, digest) = one_executable(job)?;
        let shared = Shared(Arc::from(store));
        let pipe = pipes::pipe_dir(runtime.temp_dir())?;
        let mut first =
            boxes::open_phase(runtime, &shared, &FIRST, &executable, &digest, &job.input)?;
        let second =
            boxes::open_phase(runtime, &shared, &SECOND, &executable, &digest, &job.input)?;
        let one = launch::start(
            &mut first,
            job,
            toolchain,
            runtime,
            &executable,
            &pipe,
            &FIRST,
        )?;
        finish(
            [first, second],
            one,
            job,
            toolchain,
            runtime,
            &executable,
            &pipe,
        )
    }
}

/// What is left once the first phase has been started: the second phase is started
/// beside it, both are waited for, the answer the second phase was told to write is
/// judged, and both boxes and the pipe are closed.
///
/// The two boxes arrive in the order the phases do, the first before the second, so
/// that neither the start of the second phase nor the closing of the two has to say
/// which is which.
fn finish(
    [first, mut second]: [Run; 2],
    one: Launch,
    job: &EvaluationJob,
    toolchain: &dyn Toolchain,
    runtime: &Runtime,
    executable: &str,
    pipe: &Path,
) -> Result<Evaluation, TaskError> {
    let two = launch::start(
        &mut second,
        job,
        toolchain,
        runtime,
        executable,
        pipe,
        &SECOND,
    )?;
    let (one_stats, two_stats) = (
        one.wait().map_err(TaskError::Spawn)?,
        two.wait().map_err(TaskError::Spawn)?,
    );
    let mut evaluation = verdict::decide(&one_stats, &two_stats);
    if evaluation.success {
        verdict::judge(&mut evaluation, &second, job)?;
    }
    let keep = job.archive_sandbox || !evaluation.success;
    evaluation.sandboxes = vec![first.close(keep)?, second.close(keep)?];
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
