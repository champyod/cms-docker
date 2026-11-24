//! Typed jobs keep configuration refusals as results and worker refusals as group errors.

use cms_proto::DigestMap;

use crate::job::{CompilationJob, EvaluationJob};
use crate::stage::Cache;
use crate::tasktypes::{
    BatchAndOutputAnswer, Compilation, Evaluation, Origin, OutputOnlyAnswer, Runtime, TaskError,
    TaskType, Toolchain, Verdict,
};

impl Compilation {
    /// The result of a job whose configuration prevented compilation.
    #[must_use]
    pub fn configuration_error() -> Self {
        Self {
            sandboxes: Vec::new(),
            sandbox_digests: DigestMap::new(),
            success: false,
            compilation_success: None,
            text: None,
            stats: None,
            executables: DigestMap::new(),
            diagnostics: DigestMap::new(),
        }
    }
}

impl Evaluation {
    /// The result of a job whose configuration prevented evaluation.
    #[must_use]
    pub fn configuration_error() -> Self {
        Self {
            sandboxes: Vec::new(),
            sandbox_digests: DigestMap::new(),
            success: false,
            ran: false,
            outcome: None,
            text: None,
            admin_text: None,
            stats: None,
            user_output: None,
            output_file: None,
        }
    }
}

/// Configuration refusals become failed results so one bad job does not fail its group.
pub fn compile(
    task_type: &TaskType,
    job: &CompilationJob,
    toolchain: Option<&dyn Toolchain>,
    runtime: &Runtime,
    store: Box<dyn Cache>,
) -> Result<Compilation, TaskError> {
    let result = match task_type {
        TaskType::OutputOnly(task) => Ok(task.compile()),
        TaskType::Batch(task) => with_toolchain(toolchain, |toolchain| {
            task.compile(job, toolchain, runtime, store)
        }),
        TaskType::BatchAndOutput(task) => task.compile(job, toolchain, runtime, store),
        TaskType::TwoSteps(task) => with_toolchain(toolchain, |toolchain| {
            task.compile(job, toolchain, runtime, store)
        }),
        TaskType::Communication(task) => with_toolchain(toolchain, |toolchain| {
            task.compile(job, toolchain, runtime, store)
        }),
    };
    translate(result, Compilation::configuration_error)
}

/// Configuration refusals become failed results so one bad job does not fail its group.
pub fn evaluate(
    task_type: &TaskType,
    job: &EvaluationJob,
    toolchain: Option<&dyn Toolchain>,
    runtime: &Runtime,
    store: Box<dyn Cache>,
) -> Result<Evaluation, TaskError> {
    let result = match task_type {
        TaskType::OutputOnly(task) => task
            .evaluate(job, runtime, store)
            .map(output_only_evaluation),
        TaskType::Batch(task) => with_toolchain(toolchain, |toolchain| {
            task.evaluate(job, toolchain, runtime, store)
        }),
        TaskType::BatchAndOutput(task) => task
            .evaluate(job, toolchain, runtime, store)
            .map(batch_and_output_evaluation),
        TaskType::TwoSteps(task) => with_toolchain(toolchain, |toolchain| {
            task.evaluate(job, toolchain, runtime, store)
        }),
        TaskType::Communication(task) => with_toolchain(toolchain, |toolchain| {
            task.evaluate(job, toolchain, runtime, store)
                .map(Evaluation::from)
        }),
    };
    translate(result, Evaluation::configuration_error)
}

fn output_only_evaluation(answer: OutputOnlyAnswer) -> Evaluation {
    Evaluation {
        sandboxes: Vec::new(),
        sandbox_digests: DigestMap::new(),
        success: answer.success,
        ran: false,
        outcome: answer.outcome,
        text: answer.success.then_some(answer.text),
        admin_text: answer.admin_text,
        stats: None,
        user_output: None,
        output_file: None,
    }
}

fn batch_and_output_evaluation(answer: BatchAndOutputAnswer) -> Evaluation {
    let output_file = match answer.origin {
        Some(Origin::Written(file)) => Some(file),
        Some(Origin::Carried(_)) | None => None,
    };
    Evaluation {
        sandboxes: answer.sandboxes,
        sandbox_digests: answer.sandbox_digests,
        success: answer.success,
        ran: answer.ran,
        outcome: answer.outcome,
        text: answer.success.then_some(answer.text),
        admin_text: answer.admin_text,
        stats: answer.stats,
        user_output: answer.user_output,
        output_file,
    }
}

impl From<Verdict> for Evaluation {
    fn from(verdict: Verdict) -> Self {
        Self {
            sandboxes: verdict.sandboxes,
            sandbox_digests: verdict.sandbox_digests,
            success: verdict.success,
            ran: verdict.ran,
            outcome: verdict.outcome,
            text: verdict.success.then_some(verdict.text),
            admin_text: verdict.admin_text,
            stats: verdict.stats,
            user_output: verdict.user_output,
            output_file: None,
        }
    }
}

fn with_toolchain<T>(
    toolchain: Option<&dyn Toolchain>,
    run: impl FnOnce(&dyn Toolchain) -> Result<T, TaskError>,
) -> Result<T, TaskError> {
    toolchain.map_or(Err(TaskError::NoLanguage), run)
}

fn translate<T>(
    result: Result<T, TaskError>,
    configuration_error: impl FnOnce() -> T,
) -> Result<T, TaskError> {
    match result {
        Ok(result) => Ok(result),
        Err(
            TaskError::TooFewFiles { .. }
            | TaskError::MissingManager { .. }
            | TaskError::UnexpectedExecutables { .. },
        ) => Ok(configuration_error()),
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::{Evaluation, Verdict};
    use cms_proto::DigestMap;
    use serde_json::Map;

    #[test]
    fn failed_communication_verdict_keeps_text_null() {
        let verdict = Verdict {
            sandboxes: Vec::new(),
            sandbox_digests: DigestMap::new(),
            success: false,
            ran: false,
            outcome: None,
            text: Vec::new(),
            admin_text: None,
            stats: None,
            user_output: None,
        };

        let evaluation = Evaluation::from(verdict);

        assert!(evaluation.text.is_none());
        let mut body = Map::new();
        evaluation.write_body(&mut body);
        assert!(body["text"].is_null());
        assert!(body["plus"].is_null());
    }
}
