//! Indexed min-heap that hands out queued operations in Python's order.
//!
//! `cms.io.priorityqueue.PriorityQueue` is a hand-written min-heap over
//! `(priority, timestamp, index)` tuples paired with a reverse lookup mapping
//! each item to its slot, so it can change a priority or drop an item in place
//! instead of rebuilding. [`IndexedQueue`] is the same two structures and
//! [`crate::QueueKey`] supplies the tuple, so both sides pop the same entry next.
//!
//! The invariant the type rests on: every exchange of two positions is written
//! in exactly one place, `swap`, so the map mirrors the heap after any exchange
//! by construction rather than by a rule each caller has to remember. The only
//! other write is the tail insert `push` makes when it appends; push, pop,
//! remove and `set_priority` each repair whatever path a move could disturb.
//!
//! The two halves are [`heap`], the array and the sifts that order it, and
//! [`index`], the reverse lookup that says where a named item sits. Both are
//! written here rather than in one file because the invariant above is only
//! checkable when the two writes to the lookup are visibly not the same code.

mod heap;
mod index;

use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

pub use heap::QueueEntry;

/// The current instant in the microseconds [`QueueKey`](crate::QueueKey)
/// compares: the one place a wall clock becomes a queue timestamp, mirroring
/// `make_timestamp(make_datetime())`.
#[must_use]
pub fn now_micros() -> i64 {
    let Ok(elapsed) = SystemTime::now().duration_since(UNIX_EPOCH) else {
        return i64::MIN;
    };
    i64::try_from(elapsed.as_micros()).unwrap_or(i64::MAX)
}

/// Why the queue refused an operation, naming the exception Python raises.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QueueError {
    /// The item is already queued, which Python refuses by returning `False`.
    DuplicateItem,
    /// The queue holds nothing, so there is no top to hand out (`LookupError`).
    Empty,
    /// The item is not queued, so it cannot be removed or re-prioritised
    /// (`KeyError` from `remove`, `LookupError` from `set_priority`).
    UnknownItem,
}

/// Operations waiting to be dispatched, ordered by [`QueueKey`](crate::QueueKey).
///
/// The top is the smallest key, the entry a Python service pops next. `len` and
/// `top` read it without moving it, and `Clone` on the item is the cost of the
/// reverse map, which needs the item both as its key and inside its entry.
#[derive(Debug)]
pub struct IndexedQueue<T> {
    /// The min-heap; the next to dispatch is at index 0.
    heap: Vec<QueueEntry<T>>,
    /// Reverse lookup from item to its position, kept in step by `swap` on every
    /// exchange: a stale position is what makes a queue hand out the wrong item.
    positions: HashMap<T, usize>,
    /// Enqueue sequence number, never reused, so a returning item orders behind later arrivals.
    next_index: u64,
}

impl<T> Default for IndexedQueue<T> {
    fn default() -> Self {
        Self {
            heap: Vec::new(),
            positions: HashMap::new(),
            next_index: 0,
        }
    }
}
