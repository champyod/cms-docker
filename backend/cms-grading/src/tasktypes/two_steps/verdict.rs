#![deny(missing_docs)]
#![forbid(unsafe_code)]

use crate::job::EvaluationJob;
use crate::messages::{EVALUATION_MESSAGES, EXECUTED};
use crate::tasktypes::outcome::what_went_wrong;
use crate::tasktypes::{OutputFile, Run, TaskError};
use cms_sandbox::ExecutionStats;
use cms_sandbox::ExitStatus;

use super::{Evaluation, OUTPUT};

const NO_CREDIT: f64 = 0.0;

pub(super) fn judge(
    evaluation: &mut Evaluation,
    second: &Run,
    job: &EvaluationJob,
) -> Result<(), TaskError> {
    if !evaluation.ran {
        evaluation.outcome = Some(NO_CREDIT);
        evaluation.text = Some(
            evaluation
                .stats
                .as_ref()
                .map_or_else(Vec::new, what_went_wrong),
        );
        return Ok(());
    }
    if !second.files().path(OUTPUT).is_file() {
        evaluation.outcome = Some(NO_CREDIT);
        evaluation.text = Some(
            EVALUATION_MESSAGES
                .get("nooutput")
                .message()
                .reported_naming(OUTPUT),
        );
        return Ok(());
    }
    if job.get_output.unwrap_or(false) {
        evaluation.user_output = Some(second.files().store(OUTPUT)?);
    }
    if job.only_execution.unwrap_or(false) {
        evaluation.outcome = Some(NO_CREDIT);
        evaluation.text = Some(vec![EXECUTED.to_owned()]);
        return Ok(());
    }
    evaluation.output_file = Some(OutputFile {
        path: second.files().path(OUTPUT),
        filename: OUTPUT.to_owned(),
    });
    Ok(())
}

pub(super) fn decide(first: &ExecutionStats, second: &ExecutionStats) -> Evaluation {
    let worked = |stats: &ExecutionStats| stats.exit_status != ExitStatus::SandboxError;
    let clean = |stats: &ExecutionStats| stats.exit_status == ExitStatus::Ok;
    let success = worked(first) && worked(second);
    Evaluation {
        sandboxes: Vec::new(),
        sandbox_digests: cms_proto::DigestMap::new(),
        success,
        ran: clean(first) && clean(second),
        outcome: None,
        text: if success { Some(Vec::new()) } else { None },
        admin_text: None,
        stats: if success {
            Some(first.merged_with(second, true))
        } else {
            None
        },
        user_output: None,
        output_file: None,
    }
}
