//! Dispatches one typed grading job and translates configuration refusals into results.

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
        TaskType::BatchAndOutput(task) => with_toolchain(toolchain, |toolchain| {
            task.compile(job, toolchain, runtime, store)
        }),
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
        TaskType::BatchAndOutput(task) => with_toolchain(toolchain, |toolchain| {
            task.evaluate(job, toolchain, runtime, store)
                .map(batch_and_output_evaluation)
        }),
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
            success: verdict.success,
            ran: verdict.ran,
            outcome: verdict.outcome,
            text: Some(verdict.text),
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
