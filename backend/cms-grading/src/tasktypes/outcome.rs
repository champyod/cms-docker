//! What an evaluation leaves behind, and how a judgement fills it in.
//!
//! A result is a box's own answer first and a submission's score second. The box
//! either worked or it did not; if it did, the run either did what it was asked to or
//! it was stopped, killed or returned non-zero; and if it answered, the file it wrote
//! is judged with the input, not here. This module is that order for one box and for
//! two boxes alive at once, and it is where a judge's verdict is stored.
//!
//! # Errors
//!
//! None: every value here is decided from figures a run already reported, and what a
//! judge refuses is the judge's to report before a result is built.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::path::PathBuf;

use crate::messages::{EVALUATION_MESSAGES, EXECUTED};
use crate::stage::FileDigest;
use cms_sandbox::ExecutionStats;
use cms_sandbox::ExitStatus;

use super::judge::Judgement;
use super::Run;
use super::TaskError;

const NO_CREDIT: f64 = 0.0;

/// What an evaluation left behind, as the result is filed.
#[derive(Debug, Clone, PartialEq)]
pub struct Evaluation {
    /// The paths the report names this evaluation's box by.
    pub sandboxes: Vec<PathBuf>,
    /// Whether the box worked, so that what the run reported can be believed.
    pub success: bool,
    /// Whether the run itself did what it was asked to, as against one stopped,
    /// killed or returned non-zero. It means nothing unless the box worked.
    pub ran: bool,
    /// The score, zero when the run did not answer, absent when the box did not work
    /// and when there was no answer to judge.
    pub outcome: Option<f64>,
    /// The sentences a report shows, the first of which the rest are arguments for.
    pub text: Vec<String>,
    /// What only an administrator is shown, absent where the judge wrote none.
    pub admin_text: Option<String>,
    /// What the run was charged, absent when no run was measured.
    pub stats: Option<ExecutionStats>,
    /// The digest of the run's answer, absent unless the job asked for it.
    pub user_output: Option<FileDigest>,
    /// The file the answer is in and the name the run was told to write.
    pub output_file: Option<OutputFile>,
}

/// The file a run wrote its answer to, and the name it was told to write.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutputFile {
    /// Where the answer is, on this side of the box.
    pub path: PathBuf,
    /// The filename the parameters named, empty where the answer is a redirect.
    pub filename: String,
}

impl Evaluation {
    /// Judges a run that came back: whether it wrote the file it was told to
    /// write, the digest of it where the job asked, and the file to compare.
    pub(super) fn judge(
        &mut self,
        run: &Run,
        batch: &super::Batch,
        job: &crate::job::EvaluationJob,
    ) -> Result<(), TaskError> {
        if !self.ran {
            self.outcome = Some(NO_CREDIT);
            self.text = self.stats.as_ref().map_or_else(Vec::new, what_went_wrong);
            return Ok(());
        }
        let output = batch.actual_output();
        if !run.files().path(output).is_file() {
            self.outcome = Some(NO_CREDIT);
            self.text = EVALUATION_MESSAGES
                .get("nooutput")
                .message()
                .reported_naming(output);
            return Ok(());
        }
        if job.get_output.unwrap_or(false) {
            self.user_output = Some(run.files().store(output)?);
        }
        if job.only_execution.unwrap_or(false) {
            self.outcome = Some(NO_CREDIT);
            self.text = vec![EXECUTED.to_owned()];
            return Ok(());
        }
        self.output_file = Some(OutputFile {
            path: run.files().path(output),
            filename: batch.output_filename().to_owned(),
        });
        Ok(())
    }

    /// Fills in what a judge decided, and the boxes it made to decide it.
    pub(super) fn absorb(&mut self, judgement: Judgement) {
        self.success = judgement.success;
        self.outcome = judgement.outcome;
        self.text = judgement.text;
        self.admin_text = judgement.admin_text;
        self.sandboxes.extend(judgement.sandboxes);
    }
}

/// The one sentence a report shows for a run that did not do what it was asked
/// to, and nothing for a run that ended cleanly: a run that answered is judged on
/// its answer rather than on this. The Communication task type reads the same
/// sentence for the process it is blaming, so this is the one table of them.
pub(super) fn what_went_wrong(stats: &ExecutionStats) -> Vec<String> {
    let shorthand = match stats.exit_status {
        ExitStatus::Timeout => "timeout",
        ExitStatus::TimeoutWall => "walltimeout",
        ExitStatus::MemoryLimit => "memorylimit",
        ExitStatus::Signal => "signal",
        ExitStatus::NonzeroReturn => "returncode",
        ExitStatus::Ok | ExitStatus::SandboxError => return Vec::new(),
    };
    EVALUATION_MESSAGES.get(shorthand).message().reported()
}

/// What a run's figures say, undecided when there was no command to run or the
/// box itself did not work: the figures of a box that failed are of nothing.
pub(super) fn decide(stats: Option<ExecutionStats>) -> Evaluation {
    let (success, ran) = match stats.as_ref().map(|stats| stats.exit_status) {
        Some(ExitStatus::Ok) => (true, true),
        Some(ExitStatus::SandboxError) | None => (false, false),
        Some(_) => (true, false),
    };
    Evaluation {
        sandboxes: Vec::new(),
        success,
        ran,
        outcome: None,
        text: Vec::new(),
        admin_text: None,
        stats: if success { stats } else { None },
        user_output: None,
        output_file: None,
    }
}
