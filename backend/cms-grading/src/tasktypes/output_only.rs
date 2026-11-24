//! The `OutputOnly` task type: a submission that is a list of answers rather than a
//! program, and the two phases that judge it without a box.
//!
//! A submission to an output-only task carries no source to compile. It carries one
//! text file per testcase, named after that testcase, and the answer to that
//! testcase is what the file holds. The one parameter says how that answer is
//! compared — by a plain diff, or by a checker the dataset holds — and nothing else
//! about the task is configurable.
//!
//! So both phases are short, because neither of them makes a box of its own. The
//! compilation reports that there was nothing to compile, which is a compilation that
//! worked; the evaluation names the answer for the testcase the job names and judges it
//! where the store keeps it — by a checker the dataset holds, or by a white diff — as a
//! [`Batch`](super::Batch) evaluation judges the file a run wrote. The only box a
//! carried answer ever gets is the one a checker needs to be run in.
//!
//! A submission here is partial by definition, since a contestant may answer some
//! testcases and not others. A testcase whose answer was not carried is therefore
//! scored nothing and says so, rather than refused as Batch refuses a result that
//! holds no executable.
//!
//! # Errors
//!
//! [`TaskError`], and only that: parameters that are not the one an `OutputOnly` task
//! has or whose value is not the name the declaration gives it, a digest a job carries
//! for a carried answer that the `DIGEST` domain does not admit, and what the judge
//! refuses for the answer. A missing answer is not among them — it is a score of zero.

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
/// The name a carried answer is filed under, the codename of the testcase it
/// answers held between a prefix and a suffix.
const ANSWER_PREFIX: &str = "output_";
const ANSWER_SUFFIX: &str = ".txt";
/// The sentence a report shows for a testcase whose answer was not carried, which a
/// partial submission allows.
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

/// What one `OutputOnly` evaluation is worth: the answer that was judged, or the
/// sentence that says there was none.
///
/// There is no run and so no file of a box's own: a carried answer is judged where the
/// store keeps it, and its score and sentences are the judge's.
#[derive(Debug, Clone, PartialEq)]
pub struct Answer {
    /// Whether the answer could be judged at all: false where the dataset's checker
    /// could not be run, which is not a wrong answer.
    pub success: bool,
    /// The score, zero where the testcase's answer was not carried and absent where the
    /// judge could not decide.
    pub outcome: Option<f64>,
    /// The sentences a report shows, the first of which the rest are arguments for.
    pub text: Vec<String>,
    /// What only an administrator is shown, absent where the judge wrote none.
    pub admin_text: Option<String>,
    /// The digest the carried answer is stored under. Absent where the testcase's
    /// answer was not carried.
    pub output: Option<FileDigest>,
}

impl OutputOnly {
    /// Reads the one parameter an `OutputOnly` task type is configured with: the
    /// output-evaluation choice.
    ///
    /// # Errors
    ///
    /// [`TaskError::Parameters`] unless the parameters are a list of exactly one, and
    /// [`TaskError::Parameter`] unless its value is one of the choice's names.
    pub fn new(parameters: &Value) -> Result<Self, TaskError> {
        let parameters = Parameters::of(parameters, &PARAMETERS)?;
        Ok(Self {
            output_eval: parameters.text(0).into_owned(),
        })
    }

    /// Whether a checker the dataset holds reads the answer, rather than the two
    /// files being diffed.
    #[must_use]
    pub fn uses_comparator(&self) -> bool {
        self.output_eval == OUTPUT_EVAL_COMPARATOR
    }

    /// Compiles nothing, which is a compilation that worked: there is no source to
    /// turn into an executable, so no box is made and no run is charged.
    #[must_use]
    pub fn compile(&self) -> Compilation {
        no_compilation()
    }

    /// Judges one testcase from the answer the submission carried for it, in the
    /// reference's order: the name that answer is filed under, then the answer, then
    /// the judge.
    ///
    /// # Errors
    ///
    /// [`TaskError`], and only that: a digest a job carries for a carried answer that
    /// the `DIGEST` domain does not admit, and what the judge refuses for the answer.
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
    /// What a testcase whose answer the submission did not carry is worth: a score of
    /// zero and the sentence that says so, and no answer to hand on.
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

/// The name the answer to a testcase is submitted under, and the one it is judged
/// by: the codename of that testcase between a prefix and a suffix.
pub(super) fn answer_name(codename: &str) -> String {
    format!("{ANSWER_PREFIX}{codename}{ANSWER_SUFFIX}")
}

/// The answer a submission carries for a testcase, read by the name it is filed
/// under, which every output-only task type files it under. `None` where the
/// submission carries none: a partial submission is allowed, so a testcase nobody
/// answered is a score of zero rather than a failure.
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

/// The digest a carried answer is stored under, read as every other digest a job
/// carries is: a string the domain does not admit is refused rather than taken for
/// an answer that is not there.
fn digest_of(digest: &str) -> Result<FileDigest, TaskError> {
    Ok(handle(digest)?.digest().clone())
}

/// The compilation a task type reports for a submission with nothing to compile,
/// which is the one answer every task type that skips a compilation gives.
pub(super) fn no_compilation() -> Compilation {
    Compilation {
        sandboxes: Vec::new(),
        success: true,
        compilation_success: Some(true),
        text: vec![NOTHING_TO_COMPILE.to_owned()],
        stats: None,
        executables: DigestMap::new(),
        diagnostics: DigestMap::new(),
    }
}
