//! Writes the exact worker body of a job that has not run yet.

use serde_json::{json, Map, Value};

use cms_proto::{DigestMap, JobKey, JobKind, Operation};

use super::wire::put;
use super::{CompilationJob, EvaluationJob};

impl CompilationJob {
    /// Writes the exact worker body of a compilation that has not run yet.
    #[must_use]
    pub fn to_body(&self) -> Map<String, Value> {
        let mut body = Map::new();
        let shared = Shared {
            kind: JobKind::Compilation,
            operation: self.operation.as_ref(),
            task_type: &self.task_type,
            task_type_parameters: &self.task_type_parameters,
            language: self.language.as_deref(),
            multithreaded_sandbox: self.multithreaded_sandbox,
            archive_sandbox: self.archive_sandbox,
            files: &self.files,
            managers: &self.managers,
            info: &self.info,
        };
        write_identity(&mut body, &shared);
        write_flags(&mut body, &shared);
        write_digest_maps(&mut body, &shared);
        write_info(&mut body, &shared);
        put(&mut body, JobKey::EXECUTABLES, json!({}));
        put(&mut body, JobKey::COMPILATION_SUCCESS, Value::Null);
        write_worker_defaults(&mut body);
        body
    }
}

impl EvaluationJob {
    /// Writes the exact worker body of an evaluation that has not run yet.
    #[must_use]
    pub fn to_body(&self) -> Map<String, Value> {
        let mut body = Map::new();
        let shared = Shared {
            kind: JobKind::Evaluation,
            operation: self.operation.as_ref(),
            task_type: &self.task_type,
            task_type_parameters: &self.task_type_parameters,
            language: self.language.as_deref(),
            multithreaded_sandbox: self.multithreaded_sandbox,
            archive_sandbox: self.archive_sandbox,
            files: &self.files,
            managers: &self.managers,
            info: &self.info,
        };
        write_identity(&mut body, &shared);
        write_flags(&mut body, &shared);
        write_digest_maps(&mut body, &shared);
        put(&mut body, JobKey::EXECUTABLES, json!(self.executables));
        write_info(&mut body, &shared);
        put(&mut body, JobKey::INPUT, json!(self.input));
        put(&mut body, JobKey::OUTPUT, json!(self.output));
        put(&mut body, JobKey::TIME_LIMIT, json!(self.time_limit));
        put(&mut body, JobKey::MEMORY_LIMIT, json!(self.memory_limit));
        put(
            &mut body,
            JobKey::ONLY_EXECUTION,
            json!(self.only_execution),
        );
        put(&mut body, JobKey::GET_OUTPUT, json!(self.get_output));
        put(&mut body, JobKey::OUTCOME, Value::Null);
        put(&mut body, JobKey::USER_OUTPUT, Value::Null);
        write_worker_defaults(&mut body);
        body
    }
}

/// The build-time fields both job shapes write, borrowed for one export.
struct Shared<'a> {
    kind: JobKind,
    operation: Option<&'a Operation>,
    task_type: &'a str,
    task_type_parameters: &'a Value,
    language: Option<&'a str>,
    multithreaded_sandbox: bool,
    archive_sandbox: bool,
    files: &'a DigestMap,
    managers: &'a DigestMap,
    info: &'a str,
}

fn write_identity(body: &mut Map<String, Value>, shared: &Shared<'_>) {
    put(body, JobKey::TYPE, json!(shared.kind.as_str()));
    put(body, JobKey::OPERATION, operation_value(shared.operation));
    put(body, JobKey::TASK_TYPE, json!(shared.task_type));
    put(
        body,
        JobKey::TASK_TYPE_PARAMETERS,
        shared.task_type_parameters.clone(),
    );
    put(body, JobKey::LANGUAGE, json!(shared.language));
}

fn write_flags(body: &mut Map<String, Value>, shared: &Shared<'_>) {
    put(
        body,
        JobKey::MULTITHREADED_SANDBOX,
        json!(shared.multithreaded_sandbox),
    );
    put(body, JobKey::ARCHIVE_SANDBOX, json!(shared.archive_sandbox));
}

fn write_digest_maps(body: &mut Map<String, Value>, shared: &Shared<'_>) {
    put(body, JobKey::FILES, json!(shared.files));
    put(body, JobKey::MANAGERS, json!(shared.managers));
}

fn write_info(body: &mut Map<String, Value>, shared: &Shared<'_>) {
    put(body, JobKey::INFO, json!(shared.info));
}

/// The operation written from its five fields, null when the job carries none.
fn operation_value(operation: Option<&Operation>) -> Value {
    let Some(operation) = operation else {
        return Value::Null;
    };
    let mut object = Map::new();
    put(&mut object, JobKey::TYPE, json!(operation.kind.name()));
    put(&mut object, JobKey::OBJECT_ID, json!(operation.object_id));
    put(&mut object, JobKey::DATASET_ID, json!(operation.dataset_id));
    put(
        &mut object,
        JobKey::TESTCASE_CODENAME,
        json!(operation.testcase_codename.as_deref()),
    );
    put(
        &mut object,
        JobKey::ARCHIVE_SANDBOX,
        json!(operation.archive_sandbox),
    );
    Value::Object(object)
}

/// The result keys a job writes before the worker has filled any of them in.
fn write_worker_defaults(body: &mut Map<String, Value>) {
    put(body, JobKey::SHARD, Value::Null);
    put(body, JobKey::KEEP_SANDBOX, json!(false));
    put(body, JobKey::SANDBOXES, json!([]));
    put(body, JobKey::SANDBOX_DIGESTS, json!({}));
    put(body, JobKey::SUCCESS, Value::Null);
    put(body, JobKey::TEXT, Value::Null);
    put(body, JobKey::ADMIN_TEXT, Value::Null);
    put(body, JobKey::PLUS, Value::Null);
}
