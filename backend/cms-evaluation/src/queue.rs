//! The EvaluationService's fair queue and its cumulative status.
//!
//! Priority decides first, then the object's timestamp, then insertion order.
//! An operation is queued once: a duplicate is refused while it is waiting, but
//! the same object on another dataset is a different operation.
//!
//! `queue_status` hides the testcase dimension, because one submission can
//! contribute hundreds of evaluation rows; the entry keeps the multiplicity
//! instead, and the first timestamp the group was queued at.

use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap, HashSet};
use std::hash::{Hash, Hasher};

use chrono::NaiveDateTime;
use cms_proto::{Operation, OperationKind};

/// One queued operation with the priority the planner gave it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EvaluationOperation {
    /// The operation to run.
    pub operation: Operation,
    /// Lower numbers run first.
    pub priority: i32,
}

impl Hash for EvaluationOperation {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.operation.hash(state);
        self.priority.hash(state);
    }
}

/// One status row, grouped across the testcases of the same object and dataset.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueueStatusEntry {
    /// The operation kind the row belongs to.
    pub kind: OperationKind,
    /// The submission or user test.
    pub object_id: i64,
    /// The dataset.
    pub dataset_id: i64,
    /// The priority shared by the group.
    pub priority: i32,
    /// The first timestamp any member of the group was queued at.
    pub timestamp: NaiveDateTime,
    /// How many testcase operations the group hides.
    pub multiplicity: usize,
}

/// A fair min-heap of evaluation operations, with duplicates refused while queued.
#[derive(Debug, Default)]
pub struct EvaluationQueue {
    entries: BinaryHeap<QueueEntry>,
    queued: HashSet<EvaluationOperation>,
    /// Operations a worker has popped and not yet finished.
    claimed: HashSet<Operation>,
    /// Claimed operations an invalidation superseded; their result is dropped.
    ignored: HashSet<Operation>,
    next_sequence: u64,
}

impl EvaluationQueue {
    /// Queue one operation, returning `false` when the same operation is waiting.
    #[must_use]
    pub fn push(&mut self, operation: EvaluationOperation, timestamp: NaiveDateTime) -> bool {
        if !self.queued.insert(operation.clone()) {
            return false;
        }
        let sequence = self.next_sequence;
        self.next_sequence += 1;
        self.entries.push(QueueEntry {
            operation,
            timestamp,
            sequence,
        });
        true
    }

    /// Remove and return the most urgent operation, claiming it until release.
    pub fn pop(&mut self) -> Option<(EvaluationOperation, NaiveDateTime)> {
        self.entries.pop().map(|entry| {
            self.queued.remove(&entry.operation);
            self.claimed.insert(entry.operation.operation.clone());
            (entry.operation, entry.timestamp)
        })
    }

    /// Gives up a claim and reports whether the result is still wanted.
    ///
    /// The reference drops a result whose operation was invalidated while it
    /// ran (`EvaluationService.py:582-585`), so a worker asks this immediately
    /// before committing and discards the write when the answer is `false`.
    pub fn release(&mut self, operation: &Operation) -> bool {
        self.claimed.remove(operation);
        !self.ignored.remove(operation)
    }

    /// The number of operations waiting.
    #[must_use]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Whether no operation is waiting.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Removes every queued operation the predicate names, returning the count.
    ///
    /// Re-judging first drops work already waiting for the old result; the
    /// planner then puts only the work still owed back on this same queue.
    /// A claimed operation the predicate names is not waited for: it is marked
    /// superseded, so the worker drops the result it is about to commit.
    pub fn remove_matching(&mut self, predicate: impl Fn(&Operation) -> bool) -> usize {
        let before = self.entries.len();
        self.entries = std::mem::take(&mut self.entries)
            .into_iter()
            .filter(|entry| !predicate(&entry.operation.operation))
            .collect();
        self.queued
            .retain(|operation| !predicate(&operation.operation));
        self.ignored
            .extend(self.claimed.iter().filter(|op| predicate(op)).cloned());
        before - self.entries.len()
    }

    /// The cumulative status ordered by priority and first timestamp.
    #[must_use]
    pub fn status(&self) -> Vec<QueueStatusEntry> {
        let mut groups: HashMap<(OperationKind, i64, i64, i32), QueueStatusEntry> = HashMap::new();
        for entry in &self.entries {
            let key = (
                entry.operation.operation.kind,
                entry.operation.operation.object_id,
                entry.operation.operation.dataset_id,
                entry.operation.priority,
            );
            groups
                .entry(key)
                .and_modify(|status| {
                    status.multiplicity += 1;
                    status.timestamp = status.timestamp.min(entry.timestamp);
                })
                .or_insert(QueueStatusEntry {
                    kind: key.0,
                    object_id: key.1,
                    dataset_id: key.2,
                    priority: key.3,
                    timestamp: entry.timestamp,
                    multiplicity: 1,
                });
        }
        let mut status: Vec<_> = groups.into_values().collect();
        status.sort_by_key(|entry| (entry.priority, entry.timestamp));
        status
    }
}

#[derive(Debug, PartialEq, Eq)]
struct QueueEntry {
    operation: EvaluationOperation,
    timestamp: NaiveDateTime,
    sequence: u64,
}

impl Ord for QueueEntry {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .operation
            .priority
            .cmp(&self.operation.priority)
            .then_with(|| other.timestamp.cmp(&self.timestamp))
            .then_with(|| other.sequence.cmp(&self.sequence))
    }
}

impl PartialOrd for QueueEntry {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(second: u32) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(
            &format!("2026-01-01 00:00:{second:02}"),
            "%Y-%m-%d %H:%M:%S",
        )
        .expect("a valid timestamp")
    }

    fn operation(object_id: i64, codename: Option<&str>, priority: i32) -> EvaluationOperation {
        EvaluationOperation {
            operation: Operation {
                kind: OperationKind::Evaluation,
                object_id,
                dataset_id: 7,
                testcase_codename: codename.map(str::to_string),
                archive_sandbox: false,
            },
            priority,
        }
    }

    #[test]
    fn priority_beats_timestamp() {
        let urgent = operation(1, None, 1);
        let late = operation(2, None, 2);
        let mut queue = EvaluationQueue::default();
        assert!(queue.push(late.clone(), at(1)));
        assert!(queue.push(urgent.clone(), at(9)));

        assert_eq!(queue.pop(), Some((urgent, at(9))));
        assert_eq!(queue.pop(), Some((late, at(1))));
    }

    #[test]
    fn equal_priority_pops_the_earlier_timestamp_first() {
        let earliest = operation(1, None, 2);
        let latest = operation(2, None, 2);
        let mut queue = EvaluationQueue::default();
        assert!(queue.push(latest.clone(), at(5)));
        assert!(queue.push(earliest.clone(), at(1)));

        assert_eq!(queue.pop(), Some((earliest, at(1))));
        assert_eq!(queue.pop(), Some((latest, at(5))));
    }

    #[test]
    fn a_duplicate_is_refused_while_queued_and_accepted_after_it_pops() {
        let first = operation(1, Some("alpha"), 2);
        let mut queue = EvaluationQueue::default();
        assert!(queue.push(first.clone(), at(1)));
        assert!(!queue.push(first.clone(), at(2)));
        assert_eq!(queue.pop(), Some((first.clone(), at(1))));
        assert!(queue.push(first, at(3)));
    }

    #[test]
    fn status_hides_testcases_and_counts_them() {
        let mut queue = EvaluationQueue::default();
        assert!(queue.push(operation(1, Some("alpha"), 2), at(4)));
        assert!(queue.push(operation(1, Some("beta"), 2), at(5)));
        assert!(queue.push(operation(1, None, 1), at(9)));

        assert_eq!(
            queue.status(),
            vec![
                QueueStatusEntry {
                    kind: OperationKind::Evaluation,
                    object_id: 1,
                    dataset_id: 7,
                    priority: 1,
                    timestamp: at(9),
                    multiplicity: 1,
                },
                QueueStatusEntry {
                    kind: OperationKind::Evaluation,
                    object_id: 1,
                    dataset_id: 7,
                    priority: 2,
                    timestamp: at(4),
                    multiplicity: 2,
                },
            ]
        );
    }

    #[test]
    fn a_claimed_operation_the_invalidation_names_reports_its_result_unwanted() {
        let first = operation(1, Some("alpha"), 2);
        let mut queue = EvaluationQueue::default();
        assert!(queue.push(first.clone(), at(1)));
        let (popped, _) = queue.pop().expect("the operation pops");
        let running = popped.operation;

        queue.remove_matching(|candidate| candidate.object_id == 1);

        assert!(
            !queue.release(&running),
            "an invalidation that landed mid-operation drops the result"
        );
    }

    #[test]
    fn a_claimed_operation_the_invalidation_ignores_keeps_its_result() {
        let first = operation(1, Some("alpha"), 2);
        let mut queue = EvaluationQueue::default();
        assert!(queue.push(first.clone(), at(1)));
        let (popped, _) = queue.pop().expect("the operation pops");
        let running = popped.operation;

        queue.remove_matching(|candidate| candidate.object_id == 999);

        assert!(
            queue.release(&running),
            "an unrelated invalidation leaves the running result wanted"
        );
    }

    #[test]
    fn releasing_twice_releases_the_claim_once() {
        let first = operation(1, None, 2);
        let mut queue = EvaluationQueue::default();
        assert!(queue.push(first.clone(), at(1)));
        let (popped, _) = queue.pop().expect("the operation pops");
        let running = popped.operation;
        queue.remove_matching(|candidate| candidate.object_id == 1);

        assert!(!queue.release(&running), "the first release reports drop");
        assert!(
            queue.release(&running),
            "the second release has no supersession left to report"
        );
    }
}
