//! The `BatchAndOutput` task type: a [`Batch`](super::Batch) with a fourth
//! parameter, the testcases a dataset listed as output-only, which a submission is
//! expected to answer with a file rather than by running. Every other testcase is a
//! Batch testcase, and for one of those the two phases are the Batch phases
//! unchanged, because a task mixes the two kinds of answer per testcase rather than
//! per task.
//!
//! The order an answer is decided in is what this type exists for. An answer the
//! submission carried wins and nothing runs, since a file needs no executable, and it
//! is judged by the judge the way a run's own answer is. A testcase the dataset listed
//! as output-only is never run, because a program is not what answers it even where the
//! submission compiled one. Anything else runs the executable, and a testcase with no
//! answer carried and nothing to run is a partial submission: scored nothing, and said
//! so rather than refused.
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
use std::sync::Arc;

use cms_proto::DigestMap;
use serde_json::Value;

use super::batch::{COMPILATION, EVALUATION, USE_FILE};
use super::judge::{self, OutputSource, CHECKER_CODENAME};
use super::kinds_answer::{carries_source, listed};
use super::output_only::{carried, no_compilation};
use super::{Batch, Compilation, OutputFile, Parameter, Parameters, Runtime, TaskError, Toolchain};
use crate::job::{CompilationJob, EvaluationJob};
use crate::stage::{Cache, FileDigest};
use cms_sandbox::ExecutionStats;

/// The word a checker is given for a testcase the dataset listed as output-only.
const OUTPUT_ONLY: &str = "outputonly";
/// The word a checker is given for a testcase the executable is run for.
const BATCH: &str = "batch";

/// The comma-separated list of the testcases a dataset listed as output-only.
const OUTPUT_ONLY_TESTCASES: Parameter = Parameter::text(
    "Comma-separated list of output only testcases",
    "output_only_testcases",
    "",
);
/// The four parameters this task type declares: the three a Batch task has, then the
/// output-only testcases.
static PARAMETERS: [Parameter; 4] = [COMPILATION, USE_FILE, EVALUATION, OUTPUT_ONLY_TESTCASES];

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
    /// The score, zero where there was no answer to hand on and absent where the judge
    /// could not decide about the one that was.
    pub outcome: Option<f64>,
    /// The sentences a report shows, the first of which the rest are arguments for.
    pub text: Vec<String>,
    /// What only an administrator is shown, absent where the judge wrote none.
    pub admin_text: Option<String>,
    /// What the run was charged, absent where the answer was carried rather than run.
    pub stats: Option<ExecutionStats>,
    /// The paths the report names this evaluation's box by.
    pub sandboxes: Vec<PathBuf>,
    /// The digest each archived box was filed under, keyed by the same path the
    /// sandbox list names.
    pub sandbox_digests: DigestMap,
    /// The answer handed on, absent where there was none.
    pub origin: Option<Origin>,
    /// Whether a run did what it was asked to, false where no run was made.
    pub ran: bool,
    /// The digest of a run's answer, absent unless the job asked for it.
    pub user_output: Option<FileDigest>,
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
    /// [`TaskError::Parameters`] unless the parameters are a list of exactly four, and
    /// [`TaskError::Parameter`] for a value that is not what its declaration accepts.
    pub fn new(parameters: &Value) -> Result<Self, TaskError> {
        let parameters = Parameters::of(parameters, &PARAMETERS)?;
        Ok(Self {
            batch: Batch::of(&parameters),
            output_only: listed(&parameters.text(3)),
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

    /// The checker a dataset names for this task, or `None` where the parameters asked
    /// for a plain diff, which is the Batch parameter's own answer.
    fn checker(&self) -> Option<&'static str> {
        self.batch.uses_comparator().then_some(CHECKER_CODENAME)
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
        toolchain: Option<&dyn Toolchain>,
        runtime: &Runtime,
        store: Box<dyn Cache>,
    ) -> Result<Compilation, TaskError> {
        if !carries_source(&job.files) {
            return Ok(no_compilation());
        }
        let toolchain = toolchain.ok_or(TaskError::NoLanguage)?;
        self.batch.compile(job, toolchain, runtime, store)
    }

    /// Judges one testcase in the order the reference decides an answer in: the
    /// answer the submission carried, then a testcase nothing may run, then a run.
    /// Whichever of the first and last answered, the answer is judged — the carried one
    /// here and the run's own in the Batch phase — so this type never hands on an
    /// unjudged answer.
    ///
    /// A result holding a number of executables other than one is refused rather
    /// than run, and that is a deliberate departure from the reference, which
    /// reaches the execution step for this task type without asking the count and
    /// so runs whichever executable its result happens to list first. Nothing in a
    /// result says which of several was meant, so that run would be scored as an
    /// answer to a testcase the submission never described; refusing instead names
    /// how many were found against how many were wanted, which is a report someone
    /// can act on. The count is asked before a box is opened, so a result already
    /// wrong is refused with nothing launched and nothing left behind.
    ///
    /// # Errors
    ///
    /// [`TaskError`], and only that: a digest a job carries for a carried answer the
    /// `DIGEST` domain does not admit, a result holding a number of executables
    /// other than one, and what a [`Batch`](super::Batch) evaluation refuses.
    pub fn evaluate(
        &self,
        job: &EvaluationJob,
        toolchain: Option<&dyn Toolchain>,
        runtime: &Runtime,
        store: Box<dyn Cache>,
    ) -> Result<Answer, TaskError> {
        let codename = job
            .operation
            .as_ref()
            .and_then(|operation| operation.testcase_codename.as_deref())
            .unwrap_or_default();
        let kind = if self.is_output_only(codename) {
            OUTPUT_ONLY
        } else {
            BATCH
        };
        if let Some(answer) = carried(job, codename)? {
            let judged = judge::eval_output(
                job,
                self.checker(),
                OutputSource::Digest(answer.clone()),
                "",
                &[kind.to_owned()],
                runtime,
                Arc::from(store),
            )?;
            return Ok(Answer::carried(answer, kind, judged));
        }
        if kind == BATCH && !job.executables.is_empty() {
            let toolchain = toolchain.ok_or(TaskError::NoLanguage)?;
            let run =
                self.batch
                    .evaluate_with(job, toolchain, runtime, store, &[BATCH.to_owned()])?;
            return Ok(Answer::from_run(run, kind));
        }
        Ok(Answer::not_carried())
    }
}
