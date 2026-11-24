//! The seam between a typed job and the task type that runs it.
//!
//! [`compile`] hands a [`CompilationJob`] to the selected task type's compilation,
//! and [`evaluate`] hands an [`EvaluationJob`] to its evaluation, with the caller's
//! toolchain, runtime and store. The phase decides the work; this module only
//! dispatches it and translates its result.
//!
//! A file count, manager or executable count that cannot describe the selected
//! task is a configuration refusal: the reference records it on the job and
//! returns normally, so it becomes a failed result here. A missing toolchain,
//! stage, spawn, step or any other refusal stays an error for the whole group.
//!
//! [`Compilation`] and [`Evaluation`] keep text optional because the reference
//! writes JSON null when configuration prevented a result, while an empty list
//! means a phase ran and had no sentences to report.

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

/// Compiles one typed job, translating only configuration refusals into failed results.
///
/// # Errors
///
/// [`TaskError::NoLanguage`] when a task that reaches a language phase receives no
/// toolchain; [`TaskError::Stage`], [`TaskError::Spawn`], [`TaskError::Step`] and
/// every other non-configuration refusal propagate.
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

/// Evaluates one typed job, translating only configuration refusals into failed results.
///
/// # Errors
///
/// [`TaskError::NoLanguage`] when a task that reaches a language phase receives no
/// toolchain; [`TaskError::Stage`], [`TaskError::Spawn`], [`TaskError::Step`] and
/// every other non-configuration refusal propagate.
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
        sandboxes: answer.sandboxes,
        sandbox_digests: answer.sandbox_digests,
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
