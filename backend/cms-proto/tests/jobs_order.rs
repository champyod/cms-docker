//! Dispatch-order tests for the queue key.
//!
//! The contract is Python's: `priorityqueue` pops the smallest
//! `(priority, timestamp, index)` tuple, so these tests push keys through a
//! `BinaryHeap` of `Reverse` and check that what comes out is what the Python
//! service would have handed to a worker.

use std::cmp::Reverse;
use std::collections::BinaryHeap;

use cms_proto::{
    QueueKey, PRIORITY_EXTRA_HIGH, PRIORITY_EXTRA_LOW, PRIORITY_HIGH, PRIORITY_LOW, PRIORITY_MEDIUM,
};

const fn key(priority: i32, timestamp_micros: i64, index: u64) -> QueueKey {
    QueueKey {
        priority,
        timestamp_micros,
        index,
    }
}

/// Every key the queue holds, in the order a Python service would pop them.
fn dispatch_order(keys: &[QueueKey]) -> Vec<QueueKey> {
    let mut heap: BinaryHeap<Reverse<QueueKey>> = keys.iter().copied().map(Reverse).collect();
    let mut popped = Vec::with_capacity(keys.len());
    while let Some(Reverse(entry)) = heap.pop() {
        popped.push(entry);
    }
    popped
}

#[test]
fn higher_priority_is_dispatched_before_an_older_request() {
    let older_low = key(PRIORITY_LOW, 1_000, 0);
    let newer_high = key(PRIORITY_EXTRA_HIGH, 9_000_000, 1);

    assert_eq!(
        dispatch_order(&[older_low, newer_high]),
        vec![newer_high, older_low]
    );
}

#[test]
fn every_priority_level_is_dispatched_before_the_next_lower_one() {
    let extra_high = key(PRIORITY_EXTRA_HIGH, 1, 0);
    let high = key(PRIORITY_HIGH, 1, 1);
    let medium = key(PRIORITY_MEDIUM, 1, 2);
    let low = key(PRIORITY_LOW, 1, 3);
    let extra_low = key(PRIORITY_EXTRA_LOW, 1, 4);

    let dispatched = dispatch_order(&[extra_high, high, medium, low, extra_low]);

    assert_eq!(dispatched, vec![extra_high, high, medium, low, extra_low]);
}

#[test]
fn older_request_is_dispatched_first_within_one_priority() {
    let older = key(PRIORITY_MEDIUM, 1_000, 7);
    let newer = key(PRIORITY_MEDIUM, 2_000, 8);

    assert_eq!(dispatch_order(&[newer, older]), vec![older, newer]);
}

#[test]
fn equal_priority_and_timestamp_are_dispatched_in_enqueue_order() {
    let first = key(PRIORITY_MEDIUM, 1_000, 3);
    let second = key(PRIORITY_MEDIUM, 1_000, 4);

    assert_eq!(dispatch_order(&[second, first]), vec![first, second]);
}

#[test]
fn dispatch_order_follows_the_tuple_priority_then_timestamp_then_index() {
    // The expected order is written out by hand rather than sorted with the
    // derived `Ord`: sorting would compare the key with itself, so a key whose
    // fields were declared in the wrong order would pass here. The two
    // extra-high entries are the load: the older one carries the lower index,
    // so timestamp and index disagree about which of them goes first, and
    // swapping those two fields (or promoting either of them ahead of
    // `priority`) produces a different order.
    let queued = [
        key(PRIORITY_EXTRA_HIGH, 900, 0),
        key(PRIORITY_EXTRA_HIGH, 100, 1),
        key(PRIORITY_MEDIUM, 100, 2),
        key(PRIORITY_LOW, 0, 3),
    ];

    assert_eq!(
        dispatch_order(&queued),
        vec![
            key(PRIORITY_EXTRA_HIGH, 100, 1),
            key(PRIORITY_EXTRA_HIGH, 900, 0),
            key(PRIORITY_MEDIUM, 100, 2),
            key(PRIORITY_LOW, 0, 3),
        ]
    );
}

#[test]
fn a_queued_key_is_unchanged_by_a_round_trip_through_the_heap() {
    let queued = key(PRIORITY_HIGH, 42_000, 5);

    let mut heap = BinaryHeap::new();
    heap.push(Reverse(queued));

    assert_eq!(heap.pop(), Some(Reverse(queued)));
}
