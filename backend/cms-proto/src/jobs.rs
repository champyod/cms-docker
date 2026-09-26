//! Ordering rules for the queue of operations waiting to be evaluated.
//!
//! `cms.io.priorityqueue` dispatches work from a min-heap whose elements are
//! compared as a `(priority, timestamp, index)` tuple, and the services rely
//! on that exact sequence: a higher priority is dispatched before an older
//! request, and two requests that tie are dispatched in the order they were
//! enqueued. [`QueueKey`] reproduces the tuple so the two implementations
//! make the same choice at the top of the queue.
//!
//! The three types are deliberately separate. [`QueueKey`] is the in-memory
//! ordering key, while [`QueueEntryDto`] and [`JobGroup`] are the payloads a
//! service reads from or writes to the wire; a queue status reply cannot
//! reproduce the key, because it carries no enqueue index.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Priority of an operation dispatched before every lower one.
///
/// Mirrors `PriorityQueue.PRIORITY_EXTRA_HIGH`; the levels are ordered by
/// value because the queue is a min-heap, so a smaller number goes out first.
pub const PRIORITY_EXTRA_HIGH: i32 = 0;

/// Priority of an operation dispatched after [`PRIORITY_EXTRA_HIGH`] and
/// before [`PRIORITY_MEDIUM`].
pub const PRIORITY_HIGH: i32 = 1;

/// Priority used when a caller states none, so the queue still has a definite
/// place for the operation.
pub const PRIORITY_MEDIUM: i32 = 2;

/// Priority of an operation dispatched after [`PRIORITY_MEDIUM`] and before
/// [`PRIORITY_EXTRA_LOW`].
pub const PRIORITY_LOW: i32 = 3;

/// Priority of an operation dispatched only when nothing else is waiting.
pub const PRIORITY_EXTRA_LOW: i32 = 4;

/// Ordering key of one queued operation.
///
/// The field order is the comparison order and must stay
/// `(priority, timestamp, index)`, because that is the tuple
/// `priorityqueue.QueueEntry.__lt__` compares; reordering the fields would
/// dispatch operations in a sequence the Python service never produces.
///
/// The derived order is ascending, so a [`std::collections::BinaryHeap`] that
/// has to hand out operations in Python's order stores
/// [`std::cmp::Reverse`] of this key.
///
/// This is the in-memory key and not a wire type: the queue status reply
/// ([`QueueEntryDto`]) has no enqueue index to break ties, and its timestamp is
/// a float, which has no place in a total order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct QueueKey {
    /// Discrete priority level; a smaller value is dispatched earlier.
    pub priority: i32,
    /// Microseconds since the Unix epoch, taken when the operation was first
    /// requested, so an operation that is re-enqueued keeps its place behind
    /// the ones that were waiting longer.
    pub timestamp_micros: i64,
    /// Enqueue sequence number. It is what makes the order total: two
    /// operations that tie on priority and timestamp still have a defined
    /// order, and the one that arrived first goes out first.
    pub index: u64,
}

/// One entry of a queue, in the form a service reports it over RPC.
///
/// Mirrors `priorityqueue.QueueEntryDict`, the value `get_status` fills in and
/// the `queue_status` RPC returns: the queued item, its priority, and the time
/// the operation was first requested as the float seconds
/// `cmscommon.datetime.make_timestamp` computes. There is no index on the
/// wire, so an entry cannot stand in for a [`QueueKey`] when the order of two
/// otherwise equal operations has to be decided.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct QueueEntryDto {
    /// The queued operation, in the shape the owning service's queue item
    /// exports. Every service queues its own item type, so the payload stays
    /// opaque here and is read by the service that enqueued it.
    pub item: Value,

    /// Dispatch priority, on the same levels as [`QueueKey::priority`].
    pub priority: i32,

    /// Seconds since the Unix epoch, as the Python side sends them.
    pub timestamp: f64,
}

/// The batch of jobs a worker reports after performing operations.
///
/// Mirrors `JobGroup.export_to_dict`, the payload a worker hands to
/// `EvaluationService.action_finished`; the receiving service rebuilds it with
/// `import_from_dict`, which reads the `jobs` key.
///
/// A job is a compilation or an evaluation and the two carry different keys, so
/// each one stays opaque here and is decoded by the service that acts on its
/// results, the same rule the envelope keeps for its `__data` payload.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct JobGroup {
    /// The jobs of the batch, in the order the worker ran them.
    pub jobs: Vec<Value>,
}
