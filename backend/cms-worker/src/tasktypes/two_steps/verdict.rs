//! What the two phases left behind, and what that is worth.
//!
//! The figures are read first and merged as one run's, for the two were alive at
//! once: a box that did not work leaves the evaluation undecided and the figures of
//! nothing, and a stopped, killed or non-zero run did not do what it was asked to.
//!
//! The answer is then read in the reference's order: a run that did not do what it
//! was asked to is told why, an answer that was never written is said so, and a job
//! that only asked to be run is answered before the answer is looked for. What the
//! answer is worth is left to the comparison.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use crate::job::EvaluationJob;
use crate::measure::ExitStatus;
use crate::stats::ExecutionStats;
use crate::tasktypes::evaluate::what_went_wrong;
use crate::tasktypes::{OutputFile, Run, TaskError};

use super::{Evaluation, OUTPUT};

const NO_CREDIT: f64 = 0.0;
const NO_OUTPUT: &str = "Evaluation didn't produce file";
const EXECUTED: &str = "Execution completed successfully";

/// Fills in the score and the sentences once both boxes have worked, in the
/// reference's order: a run that did not do what it was asked to is told why, an
/// answer that was never written is said so, and a job that only asked to be run is
/// answered before the answer is looked for.
pub(super) fn judge(
    evaluation: &mut Evaluation,
    second: &Run,
    job: &EvaluationJob,
) -> Result<(), TaskError> {
    if !evaluation.ran {
        evaluation.outcome = Some(NO_CREDIT);
        evaluation.text = evaluation
            .stats
            .as_ref()
            .map_or_else(Vec::new, what_went_wrong);
        return Ok(());
    }
    if !second.files().path(OUTPUT).is_file() {
        evaluation.outcome = Some(NO_CREDIT);
        evaluation.text = vec![NO_OUTPUT.to_owned(), OUTPUT.to_owned()];
        return Ok(());
    }
    if job.get_output.unwrap_or(false) {
        evaluation.user_output = Some(second.files().store(OUTPUT)?);
    }
    if job.only_execution.unwrap_or(false) {
        evaluation.outcome = Some(NO_CREDIT);
        evaluation.text = vec![EXECUTED.to_owned()];
        return Ok(());
    }
    evaluation.output_file = Some(OutputFile {
        path: second.files().path(OUTPUT),
        filename: OUTPUT.to_owned(),
    });
    Ok(())
}

/// What the two phases' figures say, merged as one run's for they were alive at once:
/// a box that did not work is undecided, a stopped, killed or non-zero run did not do
/// what it was asked to, and the figures of a box that failed are of nothing.
pub(super) fn decide(first: &ExecutionStats, second: &ExecutionStats) -> Evaluation {
    let worked = |stats: &ExecutionStats| stats.exit_status != ExitStatus::SandboxError;
    let clean = |stats: &ExecutionStats| stats.exit_status == ExitStatus::Ok;
    let success = worked(first) && worked(second);
    Evaluation {
        sandboxes: Vec::new(),
        success,
        ran: clean(first) && clean(second),
        outcome: None,
        text: Vec::new(),
        stats: if success {
            Some(first.merged_with(second, true))
        } else {
            None
        },
        user_output: None,
        output_file: None,
    }
}
