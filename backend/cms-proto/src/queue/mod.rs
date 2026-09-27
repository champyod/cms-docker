//! Indexed min-heap that hands out queued operations in Python's order.
//!
//! `cms.io.priorityqueue.PriorityQueue` is a min-heap over
//! `(priority, timestamp, index)` tuples paired with a reverse lookup mapping
//! each item to its slot, so it can change a priority or drop an item in place
//! instead of rebuilding. [`IndexedQueue`] is a [`PriorityQueue`] holding
//! [`Reverse`] of [`crate::QueueKey`] as the priority, so both sides pop the
//! same entry next.
//!
//! The two halves are [`heap`], the container and the order every operation
//! shares, and [`index`], the operations that name one queued item to change it.
//! The container keeps the heap and the reverse lookup in step itself, so this
//! crate writes neither the sift nor the restatement of a position: a stale
//! position is what makes a queue hand out the wrong item, and a structure that
//! maintains it for every exchange cannot fall one step behind.

mod heap;
mod index;

use std::cmp::Reverse;
use std::hash::Hash;
use std::time::{SystemTime, UNIX_EPOCH};

use priority_queue::PriorityQueue;

use crate::QueueKey;

pub use heap::{QueueEntry, Slot};

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
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum QueueError {
    /// The item is already queued, which Python refuses by returning `False`.
    #[error("item is already queued")]
    DuplicateItem,
    /// The queue holds nothing, so there is no top to hand out (`LookupError`).
    #[error("queue holds no item")]
    Empty,
    /// The item is not queued, so it cannot be removed or re-prioritised
    /// (`KeyError` from `remove`, `LookupError` from `set_priority`).
    #[error("item is not queued")]
    UnknownItem,
}

/// Operations waiting to be dispatched, ordered by [`QueueKey`](crate::QueueKey).
///
/// The top is the smallest key, the entry a Python service pops next. `len` and
/// `top` read it without moving it.
#[derive(Debug)]
pub struct IndexedQueue<T> {
    /// The min-heap with the reverse lookup behind it, the two structures
    /// `priorityqueue.PriorityQueue` is: the next to dispatch is at the top, and
    /// an item is found in constant time whatever the queue's length.
    heap: PriorityQueue<Slot<T>, Reverse<QueueKey>>,
    /// Enqueue sequence number, never reused, so a returning item orders behind later arrivals.
    next_index: u64,
}

impl<T: Eq + Hash> Default for IndexedQueue<T> {
    fn default() -> Self {
        Self {
            heap: PriorityQueue::new(),
            next_index: 0,
        }
    }
}
