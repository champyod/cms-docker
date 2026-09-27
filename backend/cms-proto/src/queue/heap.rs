//! The ordered container, and the operations every queue shares.
//!
//! Everything here is about *position*: which entry is at the top, and where a
//! new one belongs. Naming an item and moving it is [`super::index`].

use std::borrow::Borrow;
use std::cmp::Reverse;
use std::hash::{Hash, Hasher};

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

/// What the container stores: the public entry, under the name the container
/// indexes it by.
///
/// A slot is identified by its item alone, because that is the name `remove` and
/// `set_priority` look up; the key rides in the container's own priority beside
/// it.
#[derive(Debug)]
pub struct Slot<T> {
    /// The entry `top` and `pop` hand back.
    pub entry: QueueEntry<T>,
}

impl<T: Hash> Hash for Slot<T> {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.entry.item.hash(state);
    }
}

impl<T: Eq> PartialEq for Slot<T> {
    fn eq(&self, other: &Self) -> bool {
        self.entry.item == other.entry.item
    }
}

impl<T: Eq> Eq for Slot<T> {}

/// Lends the item out under its own name, so a lookup hands the container the
/// caller's own reference instead of an owned copy of the item to compare.
impl<T> Borrow<T> for Slot<T> {
    fn borrow(&self) -> &T {
        &self.entry.item
    }
}

impl<T: Eq + Hash> IndexedQueue<T> {
    /// Creates a queue holding nothing.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// How many items are queued.
    #[must_use]
    pub fn len(&self) -> usize {
        self.heap.len()
    }

    /// Reports whether nothing is queued, without blocking.
    #[must_use]
    pub fn is_empty(&self) -> bool {
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
        if self.heap.contains(&item) {
            return Err(QueueError::DuplicateItem);
        }
        let index = self.next_index;
        self.next_index += 1;
        let key = QueueKey {
            priority: priority.unwrap_or(PRIORITY_MEDIUM),
            timestamp_micros: timestamp_micros.unwrap_or_else(now_micros),
            index,
        };
        self.heap.push(
            Slot {
                entry: QueueEntry { item, key },
            },
            Reverse(key),
        );
        Ok(())
    }

    /// The entry that would be dispatched next, left in place.
    ///
    /// # Errors
    ///
    /// [`QueueError::Empty`] when nothing is queued. A peek touches no position,
    /// so it is safe to repeat and costs the same however full the queue is.
    pub fn top(&self) -> Result<&QueueEntry<T>, QueueError> {
        let (slot, _) = self.heap.peek().ok_or(QueueError::Empty)?;
        Ok(&slot.entry)
    }

    /// Removes the entry that would be dispatched next and returns it.
    ///
    /// # Errors
    ///
    /// [`QueueError::Empty`] when nothing is queued, leaving the queue as it was.
    pub fn pop(&mut self) -> Result<QueueEntry<T>, QueueError> {
        let (slot, _) = self.heap.pop().ok_or(QueueError::Empty)?;
        Ok(slot.entry)
    }
}
