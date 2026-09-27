//! Where each item sits, and the two operations that need that to change a
//! queued item in place.
//!
//! The reverse lookup exists so `remove` and `set_priority` can name an item
//! instead of searching for it. It is a mirror of the heap, so it is written
//! here in one place — [`IndexedQueue::restate`] for every exchange and
//! [`IndexedQueue::forget`] for every removal — rather than beside each sift.

use std::hash::Hash;

use super::{heap::QueueEntry, IndexedQueue, QueueError};

impl<T: Clone + Eq + Hash> IndexedQueue<T> {
    /// Reports whether the item is queued, the lookup `remove`/`set_priority` use.
    #[must_use]
    pub fn contains(&self, item: &T) -> bool {
        self.positions.contains_key(item)
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
        self.forget(item);
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
    pub(super) fn position_of(&self, item: &T) -> Result<usize, QueueError> {
        self.positions
            .get(item)
            .copied()
            .ok_or(QueueError::UnknownItem)
    }

    /// Restates two positions in the reverse lookup after the heap exchanged them.
    pub(super) fn restate(&mut self, first: usize, second: usize) {
        self.positions.insert(self.heap[first].item.clone(), first);
        self.positions
            .insert(self.heap[second].item.clone(), second);
    }

    /// Drops the lookup entry of an item the heap no longer holds.
    pub(super) fn forget(&mut self, item: &T) {
        self.positions.remove(item);
    }
}
