//! The array and the two sifts that keep it ordered.
//!
//! Everything here is about *position*: what sits where, and which way an entry
//! moves when a position changes. Naming an item and moving it is [`super::index`].

use std::hash::Hash;

use crate::jobs::{QueueKey, PRIORITY_MEDIUM};

use super::{now_micros, IndexedQueue, QueueError};

/// One queued item with the key it is dispatched by: `priorityqueue.QueueEntry`,
/// whose priority, timestamp and enqueue index are the one [`QueueKey`] tuple.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueueEntry<T> {
    /// The queued item, in the shape its own service enqueued it.
    pub item: T,
    /// The tuple `priorityqueue.QueueEntry.__lt__` compares, in that order.
    pub key: QueueKey,
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
        self.forget(&entry.item);
        if !self.heap.is_empty() {
            self.sink(0);
        }
        Ok(entry)
    }

    /// Exchanges two positions and restates both in the reverse lookup.
    pub(super) fn swap(&mut self, first: usize, second: usize) {
        self.heap.swap(first, second);
        self.restate(first, second);
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
    pub(super) fn repair(&mut self, position: usize) {
        self.lift(position);
        self.sink(position);
    }
}
