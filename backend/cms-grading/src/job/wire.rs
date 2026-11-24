//! Bridges raw worker job bodies to typed task-type inputs and results.

use std::path::PathBuf;

use serde_json::{json, Map, Value};

use cms_proto::{
    check_key_set, field, key_set_for, DigestMap, JobError, JobKey, JobKind, Operation,
};
use cms_sandbox::{ExecutionStats, ExitStatus};

use crate::stage::FileDigest;
use crate::tasktypes::{sandbox_path, Compilation, Evaluation};

use super::{CompilationJob, EvaluationJob};

impl CompilationJob {
    /// Reads a compilation body, refusing keys or values outside the pinned shape.
    pub fn from_body(body: &Map<String, Value>) -> Result<Self, JobError> {
        check_body(body, JobKind::Compilation)?;
        Ok(Self {
            operation: read_operation(body)?,
            task_type: field(body, JobKey::TASK_TYPE)?,
            task_type_parameters: field(body, JobKey::TASK_TYPE_PARAMETERS)?,
            language: field(body, JobKey::LANGUAGE)?,
            multithreaded_sandbox: field(body, JobKey::MULTITHREADED_SANDBOX)?,
            archive_sandbox: field(body, JobKey::ARCHIVE_SANDBOX)?,
            files: field(body, JobKey::FILES)?,
            managers: field(body, JobKey::MANAGERS)?,
            info: field(body, JobKey::INFO)?,
        })
    }
}

impl EvaluationJob {
    /// Reads an evaluation body, refusing keys or values outside the pinned shape.
    pub fn from_body(body: &Map<String, Value>) -> Result<Self, JobError> {
        check_body(body, JobKind::Evaluation)?;
        Ok(Self {
            operation: read_operation(body)?,
            task_type: field(body, JobKey::TASK_TYPE)?,
            task_type_parameters: field(body, JobKey::TASK_TYPE_PARAMETERS)?,
            language: field(body, JobKey::LANGUAGE)?,
            multithreaded_sandbox: field(body, JobKey::MULTITHREADED_SANDBOX)?,
            archive_sandbox: field(body, JobKey::ARCHIVE_SANDBOX)?,
            files: field(body, JobKey::FILES)?,
            managers: field(body, JobKey::MANAGERS)?,
            executables: field(body, JobKey::EXECUTABLES)?,
            input: field(body, JobKey::INPUT)?,
            output: field(body, JobKey::OUTPUT)?,
            time_limit: field(body, JobKey::TIME_LIMIT)?,
            memory_limit: field(body, JobKey::MEMORY_LIMIT)?,
            only_execution: field(body, JobKey::ONLY_EXECUTION)?,
            get_output: field(body, JobKey::GET_OUTPUT)?,
            info: field(body, JobKey::INFO)?,
        })
    }
}

impl Compilation {
    /// Writes the compilation result into the raw job body the worker returns.
    pub fn write_body(&self, body: &mut Map<String, Value>) {
        write_run(
            body,
            self.success,
            self.text.as_deref(),
            &self.sandboxes,
            &self.sandbox_digests,
            self.stats.as_ref(),
        );
        put(
            body,
            JobKey::COMPILATION_SUCCESS,
            json!(self.compilation_success),
        );
        put(body, JobKey::EXECUTABLES, json!(self.executables));
    }
}

impl Evaluation {
    /// Writes the evaluation result into the raw job body the worker returns.
    pub fn write_body(&self, body: &mut Map<String, Value>) {
        write_run(
            body,
            self.success,
            self.text.as_deref(),
            &self.sandboxes,
            &self.sandbox_digests,
            self.stats.as_ref(),
        );
        put(body, JobKey::ADMIN_TEXT, json!(self.admin_text));
        put(
            body,
            JobKey::OUTCOME,
            json!(self.outcome.map(|score| json!(score).to_string())),
        );
        put(
            body,
            JobKey::USER_OUTPUT,
            json!(self.user_output.as_ref().map(FileDigest::as_str)),
        );
    }
}

fn write_run(
    body: &mut Map<String, Value>,
    success: bool,
    text: Option<&[String]>,
    sandboxes: &[PathBuf],
    sandbox_digests: &DigestMap,
    stats: Option<&ExecutionStats>,
) {
    put(body, JobKey::SUCCESS, json!(success));
    put(body, JobKey::TEXT, json!(text));
    put(body, JobKey::SANDBOXES, json!(sandbox_paths(sandboxes)));
    put(body, JobKey::SANDBOX_DIGESTS, json!(sandbox_digests));
    put(body, JobKey::PLUS, plus_value(stats, success));
}

/// The `plus` metadata: the run's statistics, an empty object when the box worked
/// but measured nothing, and null only when the box itself failed.
///
/// `OutputOnly.compile` writes `{}` for a task that needs no compilation
/// (`OutputOnly.py:111`) and `{} if box_success else None` after an evaluation
/// (`:138`), so "nothing measured" and "nothing worked" are different answers.
fn plus_value(stats: Option<&ExecutionStats>, success: bool) -> Value {
    match stats {
        Some(stats) => stats_value(stats),
        None if success => Value::Object(Map::new()),
        None => Value::Null,
    }
}

fn put(body: &mut Map<String, Value>, key: JobKey, value: Value) {
    body.insert(key.as_str().to_owned(), value);
}

fn sandbox_paths(paths: &[PathBuf]) -> Vec<String> {
    paths.iter().map(|path| sandbox_path(path)).collect()
}

fn stats_value(stats: &ExecutionStats) -> Value {
    let mut plus = Map::new();
    plus.insert("execution_time".to_owned(), json!(stats.cpu_time));
    plus.insert(
        "execution_wall_clock_time".to_owned(),
        json!(stats.wall_time),
    );
    plus.insert("execution_memory".to_owned(), json!(stats.memory_bytes));
    plus.insert(
        "exit_status".to_owned(),
        json!(exit_status_text(stats.exit_status)),
    );
    if let Some(signal) = stats.signal {
        plus.insert("signal".to_owned(), json!(signal));
    }
    if let Some(stdout) = &stats.stdout {
        plus.insert("stdout".to_owned(), json!(stdout));
    }
    if let Some(stderr) = &stats.stderr {
        plus.insert("stderr".to_owned(), json!(stderr));
    }
    Value::Object(plus)
}

fn exit_status_text(status: ExitStatus) -> &'static str {
    match status {
        ExitStatus::Ok => "ok",
        ExitStatus::SandboxError => "sandbox error",
        ExitStatus::Timeout => "timeout",
        ExitStatus::TimeoutWall => "wall timeout",
        ExitStatus::Signal => "signal",
        ExitStatus::MemoryLimit => "memory limit exceeded",
        ExitStatus::NonzeroReturn => "nonzero return",
    }
}

fn check_body(body: &Map<String, Value>, expected: JobKind) -> Result<(), JobError> {
    let found = JobKind::read(body)?;
    if found != expected {
        return Err(JobError::WrongValue {
            key: JobKey::TYPE.as_str(),
            detail: format!("expected {}", expected.as_str()),
        });
    }
    check_key_set(body, key_set_for(found))
}

fn read_operation(body: &Map<String, Value>) -> Result<Option<Operation>, JobError> {
    match body.get(JobKey::OPERATION.as_str()) {
        Some(Value::Null) => Ok(None),
        Some(operation) => Operation::read(operation).map(Some),
        None => Err(JobError::MissingKey {
            key: JobKey::OPERATION.as_str(),
        }),
    }
}
