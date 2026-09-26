//! Ordering rules for the queue of operations waiting to be evaluated.
//!
//! `cms.io.priorityqueue` dispatches work from a min-heap whose elements are
//! compared as a `(priority, timestamp, index)` tuple, and the services rely
//! on that exact sequence: a higher priority is dispatched before an older
//! request, and two requests that tie are dispatched in the order they were
//! enqueued. [`QueueKey`] reproduces the tuple so the two implementations
//! make the same choice at the top of the queue.

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
/// This is the in-memory key, not the wire form of a queue entry: the RPC
/// `queue_status` reply carries no index and sends the timestamp as floating
/// point seconds, so a key that claimed to serialize into that shape would
/// either drop `index` or lose the microsecond resolution the order is
/// defined on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
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
