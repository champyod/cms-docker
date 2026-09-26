//! Reading a finished batch one job at a time.
//!
//! `EvaluationService.action_finished` releases the worker *before* it reads the
//! batch: `release_worker(shard)` runs first and `JobGroup.import_from_dict`
//! second, and an import that raises loses every job in the batch, because the
//! worker is already free and nothing else will write those results. That
//! ordering is why the requeue signal exists at all, and it is why the loss has
//! to be made impossible rather than merely logged: the worker is gone by the
//! time the data is looked at.
//!
//! [`FinishedCall::isolate`] therefore reads nothing as a batch. Each job is
//! checked against the key set of its own kind on its own, so a job carrying the
//! wrong keys, the wrong value, or another worker's shard costs only itself and
//! says which operation its result is missing for. The only way to lose a whole
//! batch is for the batch not to be a `{"jobs": [...]}` object at all, which is
//! a batch that named no operation to begin with.

use std::collections::HashSet;

use serde::Deserialize;
use serde_json::{Map, Value};

use super::job::{DecodedJob, EvaluationOutcome, KindExtras};
use super::keys::{check_key_set, field, key_set_for, JobKind};
use super::operation::{Operation, Shard};
use super::refusal::{JobError, Quarantine, Requeue};
use super::JobGroup;

/// A call to `action_finished`: the outer wrapper a worker reports through.
///
/// `__data` of the call is the argument dictionary, and the nesting is two
/// levels: the wrapper below carries the worker's [`JobGroup`] under its own
/// `data` key, and the group carries the jobs. The shard sits beside the group
/// rather than inside it, which is why it is a field here and why every job has
/// to name the same one.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FinishedCall {
    /// The worker's batch, still unread: the `JobGroup` under the `data` key.
    pub data: Value,
    /// The worker that was released, which every job of the batch must name.
    pub shard: Shard,
    /// The failure the worker reported instead of results, if it reported one.
    pub error: Option<String>,
}

/// One job of a batch, decoded or refused on its own.
///
/// The decoded job is boxed because a batch holds one of these per job, and the
/// unboxed form would reserve room for a whole decoded job on every entry of the
/// vector, including the refused ones that are far smaller.
#[derive(Debug, Clone, PartialEq)]
pub enum JobOutcome {
    /// The job carried exactly the keys of its kind and may be written.
    Decoded(Box<DecodedJob>),
    /// The job was refused; every other job of the batch is unaffected.
    Quarantined(Quarantine),
}

/// One finished batch, split job by job: the results that may be written and the
/// jobs that were refused.
#[derive(Debug, Clone, PartialEq)]
pub struct IsolatedBatch {
    outcomes: Vec<JobOutcome>,
}

impl IsolatedBatch {
    /// Collects the outcomes of one batch, in the order the jobs appeared in it.
    #[must_use]
    pub const fn new(outcomes: Vec<JobOutcome>) -> Self {
        Self { outcomes }
    }

    /// The jobs whose results may be written, in the order the worker ran them.
    #[must_use]
    pub fn committed(&self) -> Vec<&DecodedJob> {
        self.outcomes
            .iter()
            .filter_map(|outcome| match outcome {
                JobOutcome::Decoded(job) => Some(job.as_ref()),
                JobOutcome::Quarantined(_) => None,
            })
            .collect()
    }

    /// The jobs that were refused, each with its reason and its requeue signal.
    #[must_use]
    pub fn quarantined(&self) -> Vec<&Quarantine> {
        self.outcomes
            .iter()
            .filter_map(|outcome| match outcome {
                JobOutcome::Decoded(_) => None,
                JobOutcome::Quarantined(quarantine) => Some(quarantine),
            })
            .collect()
    }
}

impl FinishedCall {
    /// Isolates the batch, one job at a time.
    ///
    /// # Errors
    ///
    /// Returns [`JobError::WorkerFailed`] when the worker reported a failure,
    /// which loses the batch by the same rule the Python service follows, and
    /// [`JobError::MalformedBatch`] when `data` is not a `{"jobs": [...]}`
    /// object. Both are whole-batch failures that happen before any job is
    /// identified; every refusal of a job that *was* identified comes back
    /// inside the [`IsolatedBatch`] instead.
    pub fn isolate(&self) -> Result<IsolatedBatch, JobError> {
        if let Some(detail) = &self.error {
            return Err(JobError::WorkerFailed {
                detail: detail.clone(),
            });
        }
        let group =
            JobGroup::deserialize(&self.data).map_err(|source| JobError::MalformedBatch {
                detail: source.to_string(),
            })?;
        Ok(IsolatedBatch::new(self.isolate_jobs(&group.jobs)))
    }

    /// Isolates each job of a batch, in the order the worker ran them.
    fn isolate_jobs(&self, jobs: &[Value]) -> Vec<JobOutcome> {
        let mut dispatched: HashSet<Operation> = HashSet::new();
        jobs.iter()
            .enumerate()
            .map(|(index, job)| self.isolate_job(index, job, &mut dispatched))
            .collect()
    }

    /// Isolates one job, quarantining it rather than failing the batch.
    ///
    /// The operation is read first and on its own, so a job refused for any
    /// other reason can still say which operation its result is missing for.
    /// It is claimed only once the job has decoded, because a job that was
    /// refused must not take the operation of the good job behind it.
    fn isolate_job(
        &self,
        index: usize,
        job: &Value,
        dispatched: &mut HashSet<Operation>,
    ) -> JobOutcome {
        let operation = match read_operation(job) {
            Ok(operation) => operation,
            Err(reason) => return JobOutcome::Quarantined(Quarantine::lost(index, reason, None)),
        };
        match self.decode(job, operation.as_ref()) {
            Err(reason) => JobOutcome::Quarantined(Quarantine::lost(index, reason, operation)),
            Ok(_) if !claim(operation.as_ref(), dispatched) => {
                JobOutcome::Quarantined(Quarantine {
                    index,
                    reason: JobError::DuplicateOperation,
                    operation,
                    requeue: Requeue::AlreadyReturned,
                })
            }
            Ok(decoded) => JobOutcome::Decoded(Box::new(decoded)),
        }
    }

    /// Decodes one job against the key set of the kind its `type` names.
    fn decode(&self, job: &Value, operation: Option<&Operation>) -> Result<DecodedJob, JobError> {
        let object = job.as_object().ok_or(JobError::NotAnObject)?;
        let kind = JobKind::read(object)?;
        check_key_set(object, key_set_for(kind))?;
        let shard = Shard::read(object)?;
        if shard != self.shard {
            return Err(JobError::ShardMismatch {
                job: shard,
                call: self.shard,
            });
        }
        let sandboxes = match object.get("sandboxes") {
            Some(Value::Null) => Vec::new(),
            _ => field(object, "sandboxes")?,
        };
        Ok(DecodedJob {
            kind,
            operation: operation.cloned(),
            success: field(object, "success")?,
            shard,
            sandboxes,
            files: field(object, "files")?,
            managers: field(object, "managers")?,
            executables: field(object, "executables")?,
            plus: field(object, "plus")?,
            extras: read_extras(object, kind)?,
        })
    }
}

/// Records the operation of a job that is about to be written, refusing the
/// second of two jobs for one operation.
///
/// One operation is dispatched to one worker once, so the batch cannot carry it
/// twice; the first job is the one whose result gets filed, and putting that
/// operation back on the queue would perform it a second time. A job with no
/// operation has nothing to file, so it claims nothing.
fn claim(operation: Option<&Operation>, dispatched: &mut HashSet<Operation>) -> bool {
    operation.is_none_or(|operation| dispatched.insert(operation.clone()))
}

/// Reads the operation of a job on its own, so a job refused for any other
/// reason can still name the operation its result is missing for.
///
/// # Errors
///
/// Returns [`JobError::NotAnObject`] when the job is not an object,
/// [`JobError::MissingKey`] when it carries no `operation` key, and
/// [`JobError::UnknownKey`] or [`JobError::MissingKey`] from
/// [`Operation::read`] when the operation does not carry its own five keys.
fn read_operation(job: &Value) -> Result<Option<Operation>, JobError> {
    let object = job.as_object().ok_or(JobError::NotAnObject)?;
    match object.get("operation") {
        None => Err(JobError::MissingKey { key: "operation" }),
        Some(Value::Null) => Ok(None),
        Some(operation) => Operation::read(operation).map(Some),
    }
}

/// Reads the fields the kind adds on top of the nineteen keys the two shapes
/// share.
///
/// # Errors
///
/// Returns [`JobError::MissingKey`] or [`JobError::WrongValue`] naming the key
/// whose value was refused.
fn read_extras(object: &Map<String, Value>, kind: JobKind) -> Result<KindExtras, JobError> {
    Ok(match kind {
        JobKind::Compilation => KindExtras::Compilation {
            compilation_success: field(object, "compilation_success")?,
        },
        JobKind::Evaluation => KindExtras::Evaluation(EvaluationOutcome {
            input: field(object, "input")?,
            output: field(object, "output")?,
            time_limit: field(object, "time_limit")?,
            memory_limit: field(object, "memory_limit")?,
            outcome: field(object, "outcome")?,
            user_output: field(object, "user_output")?,
            only_execution: field(object, "only_execution")?,
            get_output: field(object, "get_output")?,
        }),
    })
}
