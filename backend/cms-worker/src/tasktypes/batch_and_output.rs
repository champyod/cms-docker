//! The `BatchAndOutput` task type: a [`Batch`](super::Batch) with a fourth
//! parameter, the testcases a dataset listed as output-only, which a submission is
//! expected to answer with a file rather than by running. Every other testcase is a
//! Batch testcase, and for one of those the two phases are the Batch phases
//! unchanged, because a task mixes the two kinds of answer per testcase rather than
//! per task.
//!
//! The order an answer is decided in is what this type exists for. An answer the
//! submission carried wins and nothing runs, since a file needs no executable. A
//! testcase the dataset listed as output-only is never run, because a program is not
//! what answers it even where the submission compiled one. Anything else runs the
//! executable, and a testcase with no answer carried and nothing to run is a partial
//! submission: scored nothing, and said so rather than refused.
//!
//! # Errors
//!
//! [`TaskError`], and only that: parameters that are not the four a `BatchAndOutput`
//! task has or the three a Batch task has, a digest a job carries for a carried
//! answer the `DIGEST` domain does not admit, and everything a
//! [`Batch`](super::Batch) compilation or evaluation refuses.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::collections::BTreeSet;
use std::path::PathBuf;

use serde_json::Value;

use cms_proto::DigestMap;

use super::batch::{TaskError, SOURCE_PLACEHOLDER};
use super::output_only::{carried, no_compilation, NOT_CARRIED, NO_CREDIT};
use super::{Batch, Compilation, Evaluation, OutputFile, Runtime, Toolchain};
use crate::job::{CompilationJob, EvaluationJob};
use crate::stage::{Cache, FileDigest};
use crate::stats::ExecutionStats;

/// The word a checker is given for a testcase the dataset listed as output-only.
const OUTPUT_ONLY: &str = "outputonly";
/// The word a checker is given for a testcase the executable is run for.
const BATCH: &str = "batch";

/// The `BatchAndOutput` task type, as its four parameters say.
///
/// The three a [`Batch`](super::Batch) task has are handed to a Batch, so that task
/// type's own reading of them is the only reading of them there is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BatchAndOutput {
    batch: Batch,
    output_only: BTreeSet<String>,
}

/// Where the answer of a testcase came from, which is the whole difference between a
/// file the submission carried and a run of the executable.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Origin {
    /// The submission carried the answer under the name of that testcase, which is
    /// judged where the store keeps it and is never run.
    Carried(FileDigest),
    /// The executable was run and wrote the answer into a file of its own box.
    Written(OutputFile),
}

/// What one evaluation is worth: the answer it handed on, and the figures a run was
/// charged where one was made.
#[derive(Debug, Clone, PartialEq)]
pub struct Answer {
    /// Whether the answer handed on can be believed: a run reports through a box that
    /// has to have worked, and a carried answer needs no box.
    pub success: bool,
    /// The score, zero where there was no answer to hand on and absent where the one
    /// that was has not been judged.
    pub outcome: Option<f64>,
    /// The sentences a report shows, the first of which the rest are arguments for.
    pub text: Vec<String>,
    /// What the run was charged, absent where the answer was carried rather than run.
    pub stats: Option<ExecutionStats>,
    /// The paths the report names this evaluation's box by.
    pub sandboxes: Vec<PathBuf>,
    /// The answer handed on, absent where there was none.
    pub origin: Option<Origin>,
    /// The words a checker is given after the three files, saying which kind of
    /// testcase it is judging, and empty where no answer was handed on to give it.
    pub extra_args: Vec<String>,
}

impl BatchAndOutput {
    /// Reads the four parameters this task type is configured with: the three a Batch
    /// task has, and the comma-separated list of the testcases a dataset listed as
    /// output-only.
    ///
    /// # Errors
    ///
    /// [`TaskError::Parameters`] unless the parameters hold exactly those four, and
    /// the first three are the three a Batch task has.
    pub fn new(parameters: &Value) -> Result<Self, TaskError> {
        let entries = parameters.as_array().ok_or(TaskError::Parameters)?;
        let [compilation, names, output_eval, testcases] = entries.as_slice() else {
            return Err(TaskError::Parameters);
        };
        let batch = Batch::new(&Value::Array(vec![
            compilation.clone(),
            names.clone(),
            output_eval.clone(),
        ]))?;
        Ok(Self {
            batch,
            output_only: listed(testcases)?,
        })
    }

    /// The Batch task type every testcase not listed as output-only is judged by.
    #[must_use]
    pub const fn batch(&self) -> &Batch {
        &self.batch
    }

    /// Whether a testcase is one the dataset listed as output-only, and so is
    /// answered by a file the submission carries rather than by a run.
    #[must_use]
    pub fn is_output_only(&self, codename: &str) -> bool {
        self.output_only.contains(codename)
    }

    /// Compiles a submission carrying a source the way a Batch compilation does, and
    /// reports that none was needed for one carrying nothing but answers.
    ///
    /// # Errors
    ///
    /// [`TaskError`], and only that: everything a [`Batch`](super::Batch) compilation
    /// refuses, which is asked only once a source has been found.
    pub fn compile(
        &self,
        job: &CompilationJob,
        toolchain: &dyn Toolchain,
        runtime: &Runtime,
        store: Box<dyn Cache>,
    ) -> Result<Compilation, TaskError> {
        if !carries_source(&job.files) {
            return Ok(no_compilation());
        }
        self.batch.compile(job, toolchain, runtime, store)
    }

    /// Judges one testcase in the order the reference decides an answer in: the
    /// answer the submission carried, then a testcase nothing may run, then a run.
    ///
    /// # Errors
    ///
    /// [`TaskError`], and only that: a digest a job carries for a carried answer the
    /// `DIGEST` domain does not admit, and what a [`Batch`](super::Batch) evaluation
    /// refuses.
    pub fn evaluate(
        &self,
        job: &EvaluationJob,
        toolchain: &dyn Toolchain,
        runtime: &Runtime,
        store: Box<dyn Cache>,
    ) -> Result<Answer, TaskError> {
        let codename = job
            .operation
            .testcase_codename
            .as_deref()
            .unwrap_or_default();
        let kind = if self.is_output_only(codename) {
            OUTPUT_ONLY
        } else {
            BATCH
        };
        if let Some(answer) = carried(job, codename)? {
            return Ok(Answer::carried(answer, kind));
        }
        if kind == BATCH && !job.executables.is_empty() {
            let run = self.batch.evaluate(job, toolchain, runtime, store)?;
            return Ok(Answer::from_run(run, kind));
        }
        Ok(Answer::not_carried())
    }
}

impl Answer {
    /// What a testcase the submission carried an answer for is worth: the digest the
    /// answer is kept under, and the word a checker is told which kind it holds.
    fn carried(answer: FileDigest, kind: &'static str) -> Self {
        Self {
            success: true,
            outcome: None,
            text: Vec::new(),
            stats: None,
            sandboxes: Vec::new(),
            origin: Some(Origin::Carried(answer)),
            extra_args: vec![kind.to_owned()],
        }
    }

    /// What a testcase nothing answered is worth: a score of zero and the sentence
    /// that says so, and no answer for a checker to be handed.
    fn not_carried() -> Self {
        Self {
            success: true,
            outcome: Some(NO_CREDIT),
            text: vec![NOT_CARRIED.to_owned()],
            stats: None,
            sandboxes: Vec::new(),
            origin: None,
            extra_args: Vec::new(),
        }
    }

    /// What a run is worth as the answer it left: what the box reported, what the run
    /// was charged, and the file a comparison or a checker reads. A run that wrote no
    /// answer hands nothing on, so it is given no word either.
    fn from_run(mut run: Evaluation, kind: &'static str) -> Self {
        let origin = run.output_file.take().map(Origin::Written);
        let extra_args = if origin.is_some() {
            vec![kind.to_owned()]
        } else {
            Vec::new()
        };
        Self {
            success: run.success,
            outcome: run.outcome,
            text: run.text,
            stats: run.stats,
            sandboxes: run.sandboxes,
            origin,
            extra_args,
        }
    }
}

/// The testcases a parameter listed as output-only: a comma-separated list of
/// codenames, where one naming none is the empty set and not the empty name.
fn listed(entry: &Value) -> Result<BTreeSet<String>, TaskError> {
    let text = entry.as_str().ok_or(TaskError::Parameters)?;
    Ok(text
        .split(',')
        .filter(|codename| !codename.is_empty())
        .map(str::to_owned)
        .collect())
}

/// Whether a submission carries anything to compile, which is what decides whether a
/// compilation is attempted: an answer file is not a source.
fn carries_source(files: &DigestMap) -> bool {
    files
        .keys()
        .any(|codename| codename.ends_with(SOURCE_PLACEHOLDER))
}
