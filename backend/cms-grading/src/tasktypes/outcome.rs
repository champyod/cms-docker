#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::path::PathBuf;

use cms_proto::DigestMap;

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
    /// The archive digest of each box that was archived, keyed by its path.
    pub sandbox_digests: DigestMap,
    /// Whether the box worked, so that what the run reported can be believed.
    pub success: bool,
    /// Distinguishes a stopped or non-zero run from a box that failed.
    pub ran: bool,
    /// Keeps an unjudged run distinct from one that legitimately scored zero.
    pub outcome: Option<f64>,
    /// The sentences a report shows, absent when the configuration prevented evaluation.
    pub text: Option<Vec<String>>,
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
    pub(super) fn judge(
        &mut self,
        run: &Run,
        batch: &super::Batch,
        job: &crate::job::EvaluationJob,
    ) -> Result<(), TaskError> {
        if !self.ran {
            self.outcome = Some(NO_CREDIT);
            self.text = Some(self.stats.as_ref().map_or_else(Vec::new, what_went_wrong));
            return Ok(());
        }
        let output = batch.actual_output();
        if !run.files().path(output).is_file() {
            self.outcome = Some(NO_CREDIT);
            self.text = Some(
                EVALUATION_MESSAGES
                    .get("nooutput")
                    .message()
                    .reported_naming(output),
            );
            return Ok(());
        }
        if job.get_output.unwrap_or(false) {
            self.user_output = Some(run.files().store(output)?);
        }
        if job.only_execution.unwrap_or(false) {
            self.outcome = Some(NO_CREDIT);
            self.text = Some(vec![EXECUTED.to_owned()]);
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
        self.text = judgement.success.then_some(judgement.text);
        self.admin_text = judgement.admin_text;
        self.sandboxes.extend(judgement.sandboxes);
        self.sandbox_digests.extend(judgement.sandbox_digests);
    }
}

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

pub(super) fn decide(stats: Option<ExecutionStats>) -> Evaluation {
    let (success, ran) = match stats.as_ref().map(|stats| stats.exit_status) {
        Some(ExitStatus::Ok) => (true, true),
        Some(ExitStatus::SandboxError) | None => (false, false),
        Some(_) => (true, false),
    };
    Evaluation {
        sandboxes: Vec::new(),
        sandbox_digests: DigestMap::new(),
        success,
        ran,
        outcome: None,
        text: if success { Some(Vec::new()) } else { None },
        admin_text: None,
        stats: if success { stats } else { None },
        user_output: None,
        output_file: None,
    }
}
