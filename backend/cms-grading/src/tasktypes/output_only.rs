#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::sync::Arc;

use serde_json::Value;

use cms_proto::DigestMap;

use super::judge::{self, Judgement, OutputSource, CHECKER_CODENAME};
use super::{handle, Compilation, Parameter, Parameters, Runtime, TaskError};
use crate::job::EvaluationJob;
use crate::stage::{Cache, FileDigest};

/// The choice that has a checker read the answer rather than a plain diff.
const OUTPUT_EVAL_COMPARATOR: &str = "comparator";
/// The choice that diffs the answer rather than having a checker read it.
const OUTPUT_EVAL_DIFF: &str = "diff";
/// The one parameter this task type declares: how an answer is compared.
const EVALUATION: Parameter = Parameter::choice(
    "Output evaluation",
    "output_eval",
    "",
    &[OUTPUT_EVAL_DIFF, OUTPUT_EVAL_COMPARATOR],
);
/// The one parameter a task type of this kind is configured with.
static PARAMETERS: [Parameter; 1] = [EVALUATION];
const ANSWER_PREFIX: &str = "output_";
const ANSWER_SUFFIX: &str = ".txt";
pub(super) const NOT_CARRIED: &str = "File not submitted";
/// The score of a testcase whose answer was not carried.
pub(super) const NO_CREDIT: f64 = 0.0;
/// The sentence a report shows for a submission with nothing to compile.
const NOTHING_TO_COMPILE: &str = "No compilation needed";

/// The `OutputOnly` task type, as its one parameter says.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutputOnly {
    output_eval: String,
}

#[derive(Debug, Clone, PartialEq)]
/// Holds a carried answer's judgement without inventing a run that never happened.
pub struct Answer {
    /// Separates an undecidable check from a wrong answer worth zero.
    pub success: bool,
    /// Keeps an unjudged answer distinct from one that legitimately scored zero.
    pub outcome: Option<f64>,
    /// The sentences a report shows, the first of which the rest are arguments for.
    pub text: Vec<String>,
    /// What only an administrator is shown, absent where the judge wrote none.
    pub admin_text: Option<String>,
    /// Names the submitted answer only when the testcase actually carried one.
    pub output: Option<FileDigest>,
}

impl OutputOnly {
    /// Refuses malformed parameters before any submitted answer is judged.
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

    #[must_use]
    /// Reports success without a box because an output-only submission has no source.
    pub fn compile(&self) -> Compilation {
        no_compilation()
    }

    /// Scores only the answer named by the operation's testcase codename.
    pub fn evaluate(
        &self,
        job: &EvaluationJob,
        runtime: &Runtime,
        store: Box<dyn Cache>,
    ) -> Result<Answer, TaskError> {
        let codename = job
            .operation
            .as_ref()
            .and_then(|operation| operation.testcase_codename.as_deref())
            .unwrap_or_default();
        let Some(answer) = carried(job, codename)? else {
            return Ok(Answer::not_carried());
        };
        let checker = self.uses_comparator().then_some(CHECKER_CODENAME);
        let judged = judge::eval_output(
            job,
            checker,
            OutputSource::Digest(answer.clone()),
            "",
            &[],
            runtime,
            Arc::from(store),
        )?;
        Ok(Answer::judged(answer, judged))
    }
}

impl Answer {
    fn not_carried() -> Self {
        Self {
            success: true,
            outcome: Some(NO_CREDIT),
            text: vec![NOT_CARRIED.to_owned()],
            admin_text: None,
            output: None,
        }
    }

    /// What a carried answer is worth, as the judge decided it.
    fn judged(answer: FileDigest, judgement: Judgement) -> Self {
        Self {
            success: judgement.success,
            outcome: judgement.outcome,
            text: judgement.text,
            admin_text: judgement.admin_text,
            output: Some(answer),
        }
    }
}

pub(super) fn answer_name(codename: &str) -> String {
    format!("{ANSWER_PREFIX}{codename}{ANSWER_SUFFIX}")
}

pub(super) fn carried(
    job: &EvaluationJob,
    codename: &str,
) -> Result<Option<FileDigest>, TaskError> {
    if codename.is_empty() {
        return Ok(None);
    }
    let Some(digest) = job.files.get(&answer_name(codename)) else {
        return Ok(None);
    };
    digest_of(digest).map(Some)
}

fn digest_of(digest: &str) -> Result<FileDigest, TaskError> {
    Ok(handle(digest)?.digest().clone())
}

pub(super) fn no_compilation() -> Compilation {
    Compilation {
        sandboxes: Vec::new(),
        sandbox_digests: DigestMap::new(),
        success: true,
        compilation_success: Some(true),
        text: Some(vec![NOTHING_TO_COMPILE.to_owned()]),
        stats: None,
        executables: DigestMap::new(),
        diagnostics: DigestMap::new(),
    }
}
