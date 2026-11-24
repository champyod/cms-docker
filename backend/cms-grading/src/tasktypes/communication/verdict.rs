#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::path::PathBuf;

use cms_proto::DigestMap;

use crate::job::EvaluationJob;
use crate::stage::FileDigest;
use cms_sandbox::ExecutionStats;
use cms_sandbox::ExitStatus;

use super::charge::charged;
use super::manager::from_manager;
use crate::messages::EXECUTED;
use crate::tasktypes::outcome::what_went_wrong;
use crate::tasktypes::{Run, TaskError};

use super::{Communication, NO_CREDIT, OUTPUT};

#[derive(Debug, Clone, PartialEq)]
/// Keeps the manager's score and every process box in one transferable result.
pub struct Verdict {
    /// Names the manager first and each process in index order.
    pub sandboxes: Vec<PathBuf>,
    /// The archive digest of each box that was archived, keyed by its path.
    pub sandbox_digests: DigestMap,
    /// Separates a failed box or manager from a legitimately wrong submission.
    pub success: bool,
    /// Distinguishes a readable manager score from a stopped or reclassified run.
    pub ran: bool,
    /// The score, absent when the run did not answer.
    pub outcome: Option<f64>,
    /// Preserves the manager's contestant-facing sentence and its arguments in order.
    pub text: Vec<String>,
    /// Keeps administrator diagnostics out of the contestant-facing report.
    pub admin_text: Option<String>,
    /// What the processes were charged, absent when no box worked.
    pub stats: Option<ExecutionStats>,
    /// Preserves a requested manager file after its box is closed.
    pub user_output: Option<FileDigest>,
}

impl Communication {
    pub(super) fn judge(
        &self,
        run: &Run,
        job: &EvaluationJob,
        manager: ExecutionStats,
        users: Vec<ExecutionStats>,
    ) -> Result<Verdict, TaskError> {
        let boxes_worked = users
            .iter()
            .all(|stats| stats.exit_status != ExitStatus::SandboxError);
        let every_ran = users
            .iter()
            .all(|stats| stats.exit_status == ExitStatus::Ok);
        let charged = charged(users, job.time_limit, every_ran);
        let success = boxes_worked && manager.exit_status == ExitStatus::Ok;
        let mut verdict = Verdict {
            sandboxes: Vec::new(),
            sandbox_digests: DigestMap::new(),
            success,
            ran: charged.exit_status == ExitStatus::Ok,
            outcome: None,
            text: Vec::new(),
            admin_text: None,
            stats: if success { Some(charged) } else { None },
            user_output: None,
        };
        if success {
            self.credit(&mut verdict, job, &manager);
        }
        if job.get_output.unwrap_or(false) {
            verdict.user_output = taken(run)?;
        }
        Ok(verdict)
    }

    /// Fills in the score, the text and the administrators' own words, in that order.
    fn credit(&self, verdict: &mut Verdict, job: &EvaluationJob, manager: &ExecutionStats) {
        if job.only_execution.unwrap_or(false) {
            verdict.ran = true;
            verdict.outcome = Some(NO_CREDIT);
            verdict.text = vec![EXECUTED.to_owned()];
            return;
        }
        if !verdict.ran {
            verdict.outcome = Some(NO_CREDIT);
            verdict.text = verdict
                .stats
                .as_ref()
                .map_or_else(Vec::new, what_went_wrong);
            return;
        }
        let (outcome, text, admin) = from_manager(manager);
        verdict.ran = outcome.is_some();
        verdict.outcome = outcome;
        verdict.text = text;
        verdict.admin_text = admin;
    }
}

fn taken(run: &Run) -> Result<Option<FileDigest>, TaskError> {
    if !run.files().path(OUTPUT).is_file() {
        return Ok(None);
    }
    Ok(Some(run.files().store(OUTPUT)?))
}
