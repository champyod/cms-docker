//! What a refused job of a batch is: the reason it was refused, where it was,
//! and what must happen to the operation it was performing.
//!
//! The rule these types exist to state: one malformed job must never cost the
//! jobs beside it. `EvaluationService.action_finished` imports the whole batch
//! in one call, so a single job it cannot import takes every result in the batch
//! with it. Splitting the batch into per-job outcomes is what makes the loss
//! path a per-job cost instead.

use super::operation::{Operation, Shard};

/// Why one job of a batch was refused.
///
/// Every variant names the thing to look at, so a quarantined job can be traced
/// to a key or a value rather than to a decode failure with no context.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum JobError {
    /// The value is not a JSON object, so it has no keys to check at all.
    NotAnObject,

    /// The `type` key names neither job shape, so there is no key set to check
    /// the rest of the job against.
    UnknownJobType {
        /// The value the worker sent.
        found: String,
    },

    /// The `type` key of an operation names none of the four operations.
    UnknownOperationType {
        /// The value the worker sent.
        found: String,
    },

    /// The job or its operation carries a key the Python side would not have
    /// written, so this Rust build is not the one that produced it.
    UnknownKey {
        /// The key that is not in the set for this kind.
        key: String,
    },

    /// The job or its operation omits a key the set requires.
    MissingKey {
        /// The key that is absent.
        key: &'static str,
    },

    /// A key is present but its value is not of the declared type, which
    /// `detail` is the deserializer's own account of.
    WrongValue {
        /// The key whose value was refused.
        key: &'static str,
        /// What the deserializer expected and what it found.
        detail: String,
    },

    /// The job names a different shard than the call released. The worker stamps
    /// its own shard on every job it runs, so a mismatch means the batch belongs
    /// to another worker and filing it would write results under the wrong one.
    ShardMismatch {
        /// The shard the job names.
        job: Shard,
        /// The shard the call released.
        call: Shard,
    },

    /// The batch already carried this operation earlier, and that earlier job is
    /// the one being written. One operation is dispatched to one worker once, so
    /// a repeat is refused rather than filed twice.
    DuplicateOperation,

    /// The worker reported a failure instead of results, so the batch never held
    /// anything to read. This is the whole batch lost by design, not by a job
    /// that failed to decode.
    WorkerFailed {
        /// The message the worker sent.
        detail: String,
    },

    /// The batch itself is not a `{"jobs": [...]}` object. The only way to lose a
    /// whole batch now, because no job was ever identified.
    MalformedBatch {
        /// What the deserializer expected and what it found.
        detail: String,
    },
}

/// What must happen to the operation of a job that was quarantined.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Requeue {
    /// The operation goes back to the queue: nothing recorded a result for it,
    /// and the worker was released before the batch was read.
    Required,
    /// The operation had already gone back to the queue by the time it was
    /// released, so putting it back again would perform it twice.
    AlreadyReturned,
}

/// One refused job: where it was, what was wrong with it, and what to do about
/// the operation it was performing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Quarantine {
    /// Position in the batch, so a log line names the job that was lost.
    pub index: usize,
    /// Which key or value made the job undecodable.
    pub reason: JobError,
    /// The operation the job was performing, recovered whenever the failure left
    /// it readable, which is what makes the requeue nameable. It is absent only
    /// when the job was refused before its operation could be read, and then the
    /// operation cannot be re-enqueued by name and the batch is lost instead.
    pub operation: Option<Operation>,
    /// What must happen to that operation.
    pub requeue: Requeue,
}

impl Quarantine {
    /// Records a refused job whose operation is to go back to the queue.
    #[must_use]
    pub const fn lost(index: usize, reason: JobError, operation: Option<Operation>) -> Self {
        Self {
            index,
            reason,
            operation,
            requeue: Requeue::Required,
        }
    }
}
