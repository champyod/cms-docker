//! The `OutputOnly` task type: a submission that is a list of answers rather than a
//! program, and the two phases that judge it without a box.
//!
//! A submission to an output-only task carries no source to compile. It carries one
//! text file per testcase, named after that testcase, and the answer to that
//! testcase is what the file holds. The one parameter says how that answer is
//! compared — by a plain diff, or by a checker the dataset holds — and nothing else
//! about the task is configurable.
//!
//! So both phases are short, because neither of them makes a box. The compilation
//! reports that there was nothing to compile, which is a compilation that worked; the
//! evaluation names the answer for the testcase the job names and hands it on where
//! the store keeps it, as a [`Batch`](super::Batch) evaluation hands on the file a
//! run wrote. Judging that answer is the step after this one, so an answer that was
//! carried has no score yet.
//!
//! A submission here is partial by definition, since a contestant may answer some
//! testcases and not others. A testcase whose answer was not carried is therefore
//! scored nothing and says so, rather than refused as Batch refuses a result that
//! holds no executable.
//!
//! # Errors
//!
//! [`TaskError`], and only that: parameters that are not the one an `OutputOnly` task
//! has, and a digest a job carries for a carried answer that the `DIGEST` domain
//! does not admit. A missing answer is not among them — it is a score of zero.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use serde_json::Value;

use cms_proto::DigestMap;

use super::batch::TaskError;
use super::{handle, Compilation};
use crate::job::EvaluationJob;
use crate::stage::FileDigest;

/// The choice that has a checker read the answer rather than a plain diff.
const OUTPUT_EVAL_COMPARATOR: &str = "comparator";
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

/// What one `OutputOnly` evaluation is worth: the answer it handed on, or the sentence
/// that says there was none.
///
/// The score of an answer that was carried is absent rather than zero, because
/// judging it is the step after this one — the same answer a
/// [`Batch`](super::Batch) evaluation leaves as a file is left here as a digest.
#[derive(Debug, Clone, PartialEq)]
pub struct Answer {
    /// The score, zero where the testcase's answer was not carried and absent where
    /// the one that was has not been judged.
    pub outcome: Option<f64>,
    /// The sentences a report shows, the first of which the rest are arguments for.
    pub text: Vec<String>,
    /// The digest the carried answer is stored under, which is how a comparison or a
    /// checker reads it. Absent where the testcase's answer was not carried.
    pub output: Option<FileDigest>,
}

impl OutputOnly {
    /// Reads the one parameter an `OutputOnly` task type is configured with: the
    /// output-evaluation choice.
    ///
    /// # Errors
    ///
    /// [`TaskError::Parameters`] unless the parameters hold exactly one string.
    pub fn new(parameters: &Value) -> Result<Self, TaskError> {
        let entries = parameters.as_array().ok_or(TaskError::Parameters)?;
        let [output_eval] = entries.as_slice() else {
            return Err(TaskError::Parameters);
        };
        let output_eval = output_eval
            .as_str()
            .ok_or(TaskError::Parameters)?
            .to_owned();
        Ok(Self { output_eval })
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
    /// reference's order: the name that answer is filed under, then the answer.
    ///
    /// # Errors
    ///
    /// [`TaskError`], and only that: a digest a job carries for a carried answer that
    /// the `DIGEST` domain does not admit.
    pub fn evaluate(&self, job: &EvaluationJob) -> Result<Answer, TaskError> {
        let codename = job
            .operation
            .testcase_codename
            .as_deref()
            .unwrap_or_default();
        let Some(answer) = carried(job, codename)? else {
            return Ok(Answer::not_carried());
        };
        Ok(Answer {
            outcome: None,
            text: Vec::new(),
            output: Some(answer),
        })
    }
}

impl Answer {
    /// What a testcase whose answer the submission did not carry is worth: a score of
    /// zero and the sentence that says so, and no answer to hand on.
    fn not_carried() -> Self {
        Self {
            outcome: Some(NO_CREDIT),
            text: vec![NOT_CARRIED.to_owned()],
            output: None,
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
