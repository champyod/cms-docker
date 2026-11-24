//! A fair queue of scoring operations, ordered by submission time and insertion.

use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashSet};
use std::fmt;
use std::hash::{Hash, Hasher};

use chrono::NaiveDateTime;

use cms_db::{DatasetId, SubmissionId};

/// One submission result that needs a scoring pass.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScoringOperation {
    /// The submission whose result needs scoring.
    pub submission_id: SubmissionId,
    /// The dataset whose score type judges that submission.
    pub dataset_id: DatasetId,
}

impl Hash for ScoringOperation {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.submission_id.0.hash(state);
        self.dataset_id.0.hash(state);
    }
}

impl fmt::Display for ScoringOperation {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "scoring submission {} on dataset {}",
            self.submission_id.0, self.dataset_id.0
        )
    }
}

/// A min-heap of scoring operations, with submission time and insertion deciding fairness.
#[derive(Debug, Default)]
pub struct ScoringQueue {
    entries: BinaryHeap<QueueEntry>,
    queued: HashSet<ScoringOperation>,
    next_sequence: u64,
}

impl ScoringQueue {
    /// Queue one operation, returning `false` when it is already queued.
    #[must_use]
    pub fn push(&mut self, operation: ScoringOperation, timestamp: NaiveDateTime) -> bool {
        if !self.queued.insert(operation) {
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

    /// Remove and return the earliest queued operation and its timestamp.
    pub fn pop(&mut self) -> Option<(ScoringOperation, NaiveDateTime)> {
        self.entries.pop().map(|entry| {
            self.queued.remove(&entry.operation);
            (entry.operation, entry.timestamp)
        })
    }

    /// The number of operations waiting in the queue.
    #[must_use]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Whether no operation is waiting in the queue.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

#[derive(Debug, PartialEq, Eq)]
struct QueueEntry {
    operation: ScoringOperation,
    timestamp: NaiveDateTime,
    sequence: u64,
}

impl Ord for QueueEntry {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .timestamp
            .cmp(&self.timestamp)
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

    #[test]
    fn operation_displays_its_submission_and_dataset() {
        let operation = ScoringOperation {
            submission_id: SubmissionId(41),
            dataset_id: DatasetId(9),
        };

        assert_eq!(operation.to_string(), "scoring submission 41 on dataset 9");
    }

    #[test]
    fn queue_pops_the_earliest_submission_timestamp_first() {
        let earliest = operation(1);
        let middle = operation(2);
        let latest = operation(3);
        let mut queue = ScoringQueue::default();
        assert!(queue.is_empty());
        assert_eq!(queue.len(), 0);

        assert!(queue.push(latest, at(3)));
        assert!(queue.push(earliest, at(1)));
        assert!(queue.push(middle, at(2)));
        assert_eq!(queue.len(), 3);

        assert_eq!(queue.pop(), Some((earliest, at(1))));
        assert_eq!(queue.pop(), Some((middle, at(2))));
        assert_eq!(queue.pop(), Some((latest, at(3))));
        assert!(queue.is_empty());
        assert_eq!(queue.pop(), None);
    }

    #[test]
    fn queue_breaks_equal_timestamps_by_insertion_order() {
        let first = operation(1);
        let second = operation(2);
        let third = operation(3);
        let fourth = operation(4);
        let fifth = operation(5);
        let mut queue = ScoringQueue::default();

        assert!(queue.push(first, at(1)));
        assert!(queue.push(second, at(1)));
        assert!(queue.push(third, at(1)));
        assert!(queue.push(fourth, at(1)));
        assert!(queue.push(fifth, at(1)));

        assert_eq!(queue.pop(), Some((first, at(1))));
        assert_eq!(queue.pop(), Some((second, at(1))));
        assert_eq!(queue.pop(), Some((third, at(1))));
        assert_eq!(queue.pop(), Some((fourth, at(1))));
        assert_eq!(queue.pop(), Some((fifth, at(1))));
    }

    #[test]
    fn queue_refuses_a_duplicate_while_the_operation_is_queued() {
        let first = operation(1);
        let other_dataset = ScoringOperation {
            dataset_id: DatasetId(10),
            ..first
        };
        let mut queue = ScoringQueue::default();

        assert!(queue.push(first, at(1)));
        assert!(!queue.push(first, at(2)));
        assert!(queue.push(other_dataset, at(0)));
        assert_eq!(queue.len(), 2);
        assert_eq!(queue.pop(), Some((other_dataset, at(0))));
        assert_eq!(queue.pop(), Some((first, at(1))));
    }

    #[test]
    fn queue_accepts_an_operation_again_after_it_is_popped() {
        let operation = operation(1);
        let mut queue = ScoringQueue::default();

        assert!(queue.push(operation, at(1)));
        assert_eq!(queue.pop(), Some((operation, at(1))));
        assert!(queue.push(operation, at(2)));
        assert_eq!(queue.pop(), Some((operation, at(2))));
    }

    fn operation(submission: i32) -> ScoringOperation {
        ScoringOperation {
            submission_id: SubmissionId(submission),
            dataset_id: DatasetId(9),
        }
    }

    fn at(second: u32) -> chrono::NaiveDateTime {
        chrono::NaiveDateTime::parse_from_str(
            &format!("2026-01-01 00:00:{second:02}"),
            "%Y-%m-%d %H:%M:%S",
        )
        .expect("a valid fixture timestamp")
    }
}
