//! The two operations that name one queued item to change it.
//!
//! `remove` and `set_priority` are what the reverse lookup exists for: both
//! name an item instead of searching for it, so each costs the same however
//! full the queue is and neither rebuilds the heap.

use std::cmp::Reverse;
use std::hash::Hash;

use crate::QueueKey;

use super::{IndexedQueue, QueueEntry, QueueError, Slot};

impl<T: Eq + Hash> IndexedQueue<T> {
    /// Reports whether the item is queued, the lookup `remove`/`set_priority` use.
    #[must_use]
    pub fn contains(&self, item: &T) -> bool {
        self.heap.contains(item)
    }

    /// Drops one queued item wherever it sits, and returns the entry it held.
    ///
    /// # Errors
    ///
    /// [`QueueError::UnknownItem`] when the item is not queued, leaving it as it was.
    pub fn remove(&mut self, item: &T) -> Result<QueueEntry<T>, QueueError> {
        let (slot, _) = self.heap.remove(item).ok_or(QueueError::UnknownItem)?;
        Ok(slot.entry)
    }

    /// Moves one queued item to another priority, in place. The timestamp and the
    /// enqueue index are left alone, so the item keeps its standing among the
    /// waiters rather than re-entering at the back of its new level.
    ///
    /// # Errors
    ///
    /// [`QueueError::UnknownItem`] when the item is not queued, leaving it as it was.
    pub fn set_priority(&mut self, item: &T, priority: i32) -> Result<(), QueueError> {
        let (slot, _) = self.heap.remove(item).ok_or(QueueError::UnknownItem)?;
        let key = QueueKey {
            priority,
            ..slot.entry.key
        };
        self.heap.push(
            Slot {
                entry: QueueEntry { key, ..slot.entry },
            },
            Reverse(key),
        );
        Ok(())
    }
}
