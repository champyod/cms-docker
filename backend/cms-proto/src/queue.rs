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

use std::collections::HashMap;
use std::hash::Hash;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::jobs::{QueueKey, PRIORITY_MEDIUM};

/// The current instant in the microseconds [`QueueKey`] compares: the one place a
/// wall clock becomes a queue timestamp, mirroring `make_timestamp(make_datetime())`.
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

/// One queued item with the key it is dispatched by: `priorityqueue.QueueEntry`,
/// whose priority, timestamp and enqueue index are the one [`QueueKey`] tuple.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueueEntry<T> {
    /// The queued item, in the shape its own service enqueued it.
    pub item: T,
    /// The tuple `priorityqueue.QueueEntry.__lt__` compares, in that order.
    pub key: QueueKey,
}

/// Operations waiting to be dispatched, ordered by [`QueueKey`].
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

impl<T: Clone + Eq + Hash> IndexedQueue<T> {
    /// Creates a queue holding nothing.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// How many items are queued.
    #[must_use]
    pub const fn len(&self) -> usize {
        self.heap.len()
    }

    /// Reports whether nothing is queued, without blocking.
    #[must_use]
    pub const fn is_empty(&self) -> bool {
        self.heap.is_empty()
    }

    /// Reports whether the item is queued, the lookup `remove`/`set_priority` use.
    #[must_use]
    pub fn contains(&self, item: &T) -> bool {
        self.positions.contains_key(item)
    }

    /// Queues an item, or refuses it if it is already waiting. `priority` defaults
    /// to [`PRIORITY_MEDIUM`] and `timestamp_micros` to [`now_micros`].
    ///
    /// # Errors
    ///
    /// [`QueueError::DuplicateItem`] when the item is already queued, changing no order.
    pub fn push(
        &mut self,
        item: T,
        priority: Option<i32>,
        timestamp_micros: Option<i64>,
    ) -> Result<(), QueueError> {
        if self.positions.contains_key(&item) {
            return Err(QueueError::DuplicateItem);
        }
        let index = self.next_index;
        self.next_index += 1;
        let key = QueueKey {
            priority: priority.unwrap_or(PRIORITY_MEDIUM),
            timestamp_micros: timestamp_micros.unwrap_or_else(now_micros),
            index,
        };
        self.positions.insert(item.clone(), self.heap.len());
        self.heap.push(QueueEntry { item, key });
        // WHY: a fresh entry sits last with no children, so `repair` would add a
        // descent that provably stops where this lift did.
        self.lift(self.heap.len() - 1);
        Ok(())
    }

    /// The entry that would be dispatched next, left in place.
    ///
    /// # Errors
    ///
    /// [`QueueError::Empty`] when nothing is queued. A peek touches no position,
    /// so it is safe to repeat and costs the same however full the queue is.
    pub fn top(&self) -> Result<&QueueEntry<T>, QueueError> {
        self.heap.first().ok_or(QueueError::Empty)
    }

    /// Removes the entry that would be dispatched next and returns it.
    ///
    /// # Errors
    ///
    /// [`QueueError::Empty`] when nothing is queued, leaving the queue as it was.
    pub fn pop(&mut self) -> Result<QueueEntry<T>, QueueError> {
        if self.is_empty() {
            return Err(QueueError::Empty);
        }
        let last = self.heap.len() - 1;
        self.swap(0, last);
        let entry = self.heap.pop().ok_or(QueueError::Empty)?;
        self.positions.remove(&entry.item);
        if !self.heap.is_empty() {
            self.sink(0);
        }
        Ok(entry)
    }

    /// Drops one queued item wherever it sits, and returns the entry it held.
    ///
    /// # Errors
    ///
    /// [`QueueError::UnknownItem`] when the item is not queued, leaving it as it was.
    pub fn remove(&mut self, item: &T) -> Result<QueueEntry<T>, QueueError> {
        let position = self.position_of(item)?;
        let last = self.heap.len() - 1;
        self.swap(position, last);
        let entry = self.heap.pop().ok_or(QueueError::UnknownItem)?;
        self.positions.remove(item);
        // WHY: the entry that took the removed slot came from the bottom of the
        // heap, so it can rank above its new parent as well as below a child.
        if position != last {
            self.repair(position);
        }
        Ok(entry)
    }

    /// Moves one queued item to another priority, in place. The timestamp and the
    /// enqueue index are left alone, so the item keeps its standing among the
    /// waiters rather than re-entering at the back of its new level.
    ///
    /// # Errors
    ///
    /// [`QueueError::UnknownItem`] when the item is not queued, leaving it as it was.
    pub fn set_priority(&mut self, item: &T, priority: i32) -> Result<(), QueueError> {
        let position = self.position_of(item)?;
        let entry = self.heap.get_mut(position).ok_or(QueueError::UnknownItem)?;
        entry.key.priority = priority;
        self.repair(position);
        Ok(())
    }

    /// The position the reverse lookup holds for an item.
    fn position_of(&self, item: &T) -> Result<usize, QueueError> {
        self.positions
            .get(item)
            .copied()
            .ok_or(QueueError::UnknownItem)
    }

    /// Exchanges two positions and restates both in the reverse lookup.
    fn swap(&mut self, first: usize, second: usize) {
        self.heap.swap(first, second);
        self.positions.insert(self.heap[first].item.clone(), first);
        self.positions
            .insert(self.heap[second].item.clone(), second);
    }

    /// Raises the entry at `position` for as long as its parent outranks it.
    fn lift(&mut self, mut position: usize) {
        while position > 0 {
            let parent = (position - 1) / 2;
            if self.heap[position].key >= self.heap[parent].key {
                return;
            }
            self.swap(parent, position);
            position = parent;
        }
    }

    /// Lowers the entry at `position` for as long as a child outranks it.
    fn sink(&mut self, mut position: usize) {
        loop {
            let last = self.heap.len() - 1;
            let left = 2 * position + 1;
            if left > last {
                return;
            }
            let right = left + 1;
            let is_right_smaller = right <= last && self.heap[right].key < self.heap[left].key;
            let child = if is_right_smaller { right } else { left };
            if self.heap[child].key >= self.heap[position].key {
                return;
            }
            self.swap(child, position);
            position = child;
        }
    }

    /// Lifts then lowers, the repair a removal or a priority change needs. Neither
    /// reports where the entry landed: the map is already level with the heap.
    fn repair(&mut self, position: usize) {
        self.lift(position);
        self.sink(position);
    }
}
