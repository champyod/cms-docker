//! What a Communication evaluation left behind, and what that is worth.
//!
//! The order is the reference's and the only one that can be had: whether every box
//! worked, then the job's own two flags, then what a process is blamed for, and only
//! then what the manager printed. A job that only asked to be run is answered before
//! a process's failure is looked for, and a process's failure is answered before the
//! manager is read at all.
//!
//! A process that was stopped, killed or reclassified scores nothing and is told
//! why, in the same words a Batch run is told, which is the reference's own table.
//! Otherwise the score is the manager's, and so is every word a report shows.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::path::PathBuf;

use crate::job::EvaluationJob;
use crate::measure::ExitStatus;
use crate::stage::FileDigest;
use crate::stats::ExecutionStats;

use super::charge::charged;
use super::manager::from_manager;
use crate::tasktypes::evaluate::what_went_wrong;
use crate::tasktypes::{Run, TaskError};

use super::{Communication, EXECUTED, NO_CREDIT, OUTPUT};

/// What a Communication evaluation left behind, as the result is filed.
///
/// The score is the manager's rather than a file to be compared, and what the
/// administrators are shown is beside what a contestant is shown.
#[derive(Debug, Clone, PartialEq)]
pub struct Verdict {
    /// The paths the report names the boxes by, the manager's first and then one
    /// per process in index order.
    pub sandboxes: Vec<PathBuf>,
    /// Whether every box worked and the manager terminated correctly, so that what
    /// the manager reported can be believed.
    pub success: bool,
    /// Whether the run did what it was asked to: the manager printed a score that
    /// can be read, and no process was stopped, killed or reclassified. It means
    /// nothing unless the boxes worked.
    pub ran: bool,
    /// The score, absent when the run did not answer.
    pub outcome: Option<f64>,
    /// The sentences a report shows a contestant, the first of which the rest are
    /// arguments for.
    pub text: Vec<String>,
    /// What the manager said to the administrators, which a contestant is not shown,
    /// and what is said when nothing of the manager's could be read.
    pub admin_text: Option<String>,
    /// What the processes were charged, absent when no box worked.
    pub stats: Option<ExecutionStats>,
    /// The digest of the file the manager wrote for a user test, absent unless the
    /// job asked for it and the manager wrote one.
    pub user_output: Option<FileDigest>,
}

impl Communication {
    /// What the whole run is worth, given what the manager and the processes left
    /// behind, and whether the job asked for the manager's own file.
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

/// The file the manager wrote for a user test to be shown, stored under the digest
/// the job's report names it by, and absent where the manager wrote none.
fn taken(run: &Run) -> Result<Option<FileDigest>, TaskError> {
    if !run.files().path(OUTPUT).is_file() {
        return Ok(None);
    }
    Ok(Some(run.files().store(OUTPUT)?))
}
