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
static PARAMETERS: [Parameter; 4] = [COMPILATION, USE_FILE, EVALUATION, OUTPUT_ONLY_TESTCASES];

#[derive(Debug, Clone, PartialEq, Eq)]
/// Mixes carried answers and executable runs per testcase rather than per task.
pub struct BatchAndOutput {
    batch: Batch,
    output_only: BTreeSet<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
/// Records whether judging used a submitted file or a file the run wrote.
pub enum Origin {
    /// The submission supplied the answer, so no executable had to run.
    Carried(FileDigest),
    /// The executable was run and wrote the answer into a file of its own box.
    Written(OutputFile),
}

#[derive(Debug, Clone, PartialEq)]
/// Carries one judged testcase through the execution seam without losing its boxes.
pub struct Answer {
    /// Distinguishes an undecidable check from a wrong answer.
    pub success: bool,
    /// Keeps an unjudged answer distinct from one worth zero.
    pub outcome: Option<f64>,
    /// The sentences a report shows, the first of which the rest are arguments for.
    pub text: Vec<String>,
    /// What only an administrator is shown, absent where the judge wrote none.
    pub admin_text: Option<String>,
    /// What the run was charged, absent where the answer was carried rather than run.
    pub stats: Option<ExecutionStats>,
    /// The paths the report names this evaluation's box by.
    pub sandboxes: Vec<PathBuf>,
    /// The archive digest of each box that was archived, keyed by its path.
    pub sandbox_digests: DigestMap,
    /// The answer handed on, absent where there was none.
    pub origin: Option<Origin>,
    /// Whether a run did what it was asked to, false where no run was made.
    pub ran: bool,
    /// The digest of a run's answer, absent unless the job asked for it.
    pub user_output: Option<FileDigest>,
    /// Tells a checker whether its answer came from a run or a submitted file.
    pub extra_args: Vec<String>,
}

impl BatchAndOutput {
    /// Rejects malformed parameters before any testcase can be judged.
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

    #[must_use]
    /// Ensures listed testcases are never answered by running the executable.
    pub fn is_output_only(&self, codename: &str) -> bool {
        self.output_only.contains(codename)
    }

    fn checker(&self) -> Option<&'static str> {
        self.batch.uses_comparator().then_some(CHECKER_CODENAME)
    }

    /// Skips compilation when every submitted file is an answer rather than a source.
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

    /// Gives a carried answer precedence so a needless run cannot replace it.
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
