//! Reads worker job bodies into task-type inputs without retaining result fields.

use serde_json::{Map, Value};

use cms_proto::{check_key_set, field, key_set_for, JobError, JobKey, JobKind, Operation};

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
