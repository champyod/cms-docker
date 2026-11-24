//! Dispatches one typed grading job and translates configuration refusals into results.

use cms_proto::DigestMap;

use crate::job::CompilationJob;
use crate::stage::Cache;
use crate::tasktypes::{Compilation, Evaluation, Runtime, TaskError, TaskType, Toolchain};

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
