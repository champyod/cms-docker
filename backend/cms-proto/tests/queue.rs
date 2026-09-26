//! Dispatch-order tests for the indexed queue.
//!
//! The contract is Python's: `priorityqueue` pops the smallest
//! `(priority, timestamp, index)` tuple out of a min-heap, so these tests push
//! items through [`IndexedQueue`] and check that what comes out is the entry a
//! Python service would have handed to a worker. The expected order is written
//! out by hand rather than sorted with the derived `Ord`, because sorting would
//! compare the key against itself and could not tell a correctly ordered queue
//! from one whose key fields were declared the wrong way round.

use cms_proto::{
    now_micros, IndexedQueue, QueueEntry, QueueError, PRIORITY_EXTRA_HIGH, PRIORITY_HIGH,
    PRIORITY_LOW, PRIORITY_MEDIUM,
};

/// The item type every test queues; Python's `FakeQueueItem` is a string too.
type Item = &'static str;

/// Queues one item at an explicit priority and timestamp.
fn push(queue: &mut IndexedQueue<Item>, item: Item, priority: i32, timestamp: i64) {
    queue
        .push(item, Some(priority), Some(timestamp))
        .expect("the item is not queued yet");
}

/// Everything the queue holds, in the order it would be dispatched.
fn dispatch_order(mut queue: IndexedQueue<Item>) -> Vec<QueueEntry<Item>> {
    let mut order = Vec::with_capacity(queue.len());
    for _ in 0..queue.len() {
        let entry = queue.pop().expect("the queue length bounds the pops");
        order.push(entry);
    }
    order
}

/// The items of `entries`, for comparing an order without its keys.
fn items_of(entries: Vec<QueueEntry<Item>>) -> Vec<Item> {
    entries.into_iter().map(|entry| entry.item).collect()
}

#[test]
fn dispatch_order_follows_the_tuple_priority_then_timestamp_then_index() {
    // The two extra-high entries are the load: the older one carries the higher
    // index, so timestamp and index disagree about which of them goes first,
    // and promoting either of them ahead of `priority` produces a different
    // order here.
    let mut queue = IndexedQueue::new();
    push(&mut queue, "old-extra-high", PRIORITY_EXTRA_HIGH, 900);
    push(&mut queue, "new-extra-high", PRIORITY_EXTRA_HIGH, 100);
    push(&mut queue, "medium", PRIORITY_MEDIUM, 100);
    push(&mut queue, "low", PRIORITY_LOW, 0);

    assert_eq!(
        items_of(dispatch_order(queue)),
        vec!["new-extra-high", "old-extra-high", "medium", "low"]
    );
}

#[test]
fn an_item_already_queued_is_refused_and_the_queue_keeps_its_place() {
    let mut queue = IndexedQueue::new();
    push(&mut queue, "first", PRIORITY_MEDIUM, 1_000);
    push(&mut queue, "second", PRIORITY_MEDIUM, 2_000);

    let refusal = queue.push("first", Some(PRIORITY_EXTRA_HIGH), Some(0));

    assert_eq!(refusal, Err(QueueError::DuplicateItem));
    assert_eq!(queue.len(), 2);
    // WHY: the refused push must not have promoted the item it named, so the
    // original order is still the one a Python queue would produce.
    assert_eq!(items_of(dispatch_order(queue)), vec!["first", "second"]);
}

#[test]
fn a_removed_item_lets_the_next_one_be_dispatched_and_leaves_no_trace() {
    let mut queue = IndexedQueue::new();
    push(&mut queue, "keep", PRIORITY_MEDIUM, 1_000);
    push(&mut queue, "drop", PRIORITY_EXTRA_HIGH, 1_000);

    let removed = queue.remove(&"drop").expect("the item is queued");

    assert_eq!(removed.item, "drop");
    assert_eq!(removed.key.priority, PRIORITY_EXTRA_HIGH);
    // A stale reverse entry would make this push a duplicate of an item the
    // queue no longer holds.
    assert!(!queue.contains(&"drop"));
    assert!(queue
        .push("drop", Some(PRIORITY_MEDIUM), Some(1_000))
        .is_ok());
    // The re-queued item left and came back as a later arrival, so it now ties
    // with `keep` on priority and timestamp and loses on the enqueue index.
    assert_eq!(items_of(dispatch_order(queue)), vec!["keep", "drop"]);
}

#[test]
fn removing_an_item_repairs_the_heap_around_the_gap_it_left() {
    let mut queue = IndexedQueue::new();
    push(&mut queue, "a", PRIORITY_LOW, 1_000);
    push(&mut queue, "b", PRIORITY_MEDIUM, 1_000);
    push(&mut queue, "c", PRIORITY_HIGH, 1_000);
    push(&mut queue, "d", PRIORITY_MEDIUM, 1_000);
    push(&mut queue, "e", PRIORITY_EXTRA_HIGH, 1_000);

    queue.remove(&"c").expect("the item is queued");
    queue.remove(&"a").expect("the item is queued");

    // `c` and `a` sat inside the heap, so the entries that took their slots had
    // to be walked back down before the top was the right one again.
    assert_eq!(items_of(dispatch_order(queue)), vec!["e", "b", "d"]);
}

#[test]
fn a_promoted_item_keeps_its_standing_among_the_waiters_it_joins() {
    let mut queue = IndexedQueue::new();
    push(&mut queue, "promoted", PRIORITY_LOW, 1_000);
    push(&mut queue, "waiting", PRIORITY_MEDIUM, 2_000);

    queue
        .set_priority(&"promoted", PRIORITY_MEDIUM)
        .expect("the item is queued");

    // The promoted item was requested a second earlier, so at the level it
    // joined it keeps its place among those waiters and goes out first: the
    // timestamp is what the heap still compares.
    let order = dispatch_order(queue);
    let promoted = order
        .iter()
        .find(|entry| entry.item == "promoted")
        .expect("the item is still queued");
    assert_eq!(promoted.key.priority, PRIORITY_MEDIUM);
    assert_eq!(promoted.key.timestamp_micros, 1_000);
    assert_eq!(order[0].item, "promoted");
    assert_eq!(order[1].item, "waiting");
}

#[test]
fn demoting_the_top_item_lets_the_next_one_be_dispatched() {
    let mut queue = IndexedQueue::new();
    push(&mut queue, "first", PRIORITY_EXTRA_HIGH, 1_000);
    push(&mut queue, "second", PRIORITY_MEDIUM, 1_000);

    queue
        .set_priority(&"first", PRIORITY_MEDIUM)
        .expect("the item is queued");

    // The two now tie on priority, so the enqueue index decides, and the index
    // is the one the push handed out.
    assert_eq!(queue.len(), 2);
    assert_eq!(items_of(dispatch_order(queue)), vec!["first", "second"]);
}

#[test]
fn reading_the_top_leaves_the_queue_untouched() {
    let mut queue = IndexedQueue::new();
    push(&mut queue, "first", PRIORITY_MEDIUM, 1_000);
    push(&mut queue, "second", PRIORITY_LOW, 2_000);

    let peeked = queue.top().expect("the queue holds an item");
    let peeked_again = queue.top().expect("the queue still holds an item");

    // A peek reads the top in place: it reports the same entry both times, and
    // the entries are still queued afterwards.
    assert_eq!(peeked.item, "first");
    assert_eq!(peeked_again.item, "first");
    assert_eq!(peeked.key, peeked_again.key);
    assert_eq!(queue.len(), 2);
    assert!(queue.contains(&"first"));
    assert_eq!(items_of(dispatch_order(queue)), vec!["first", "second"]);
}

#[test]
fn an_empty_queue_refuses_everything_that_needs_an_entry() {
    let mut queue: IndexedQueue<Item> = IndexedQueue::new();

    assert!(queue.is_empty());
    assert_eq!(queue.len(), 0);
    assert_eq!(queue.top().err(), Some(QueueError::Empty));
    assert_eq!(queue.pop().err(), Some(QueueError::Empty));
    assert_eq!(queue.remove(&"absent").err(), Some(QueueError::UnknownItem));
    assert_eq!(
        queue.set_priority(&"absent", PRIORITY_MEDIUM).err(),
        Some(QueueError::UnknownItem)
    );
}

#[test]
fn a_removed_item_no_longer_takes_a_second_queued_slot() {
    let mut queue = IndexedQueue::new();
    push(&mut queue, "item", PRIORITY_MEDIUM, 1_000);
    queue.remove(&"item").expect("the item is queued");
    push(&mut queue, "item", PRIORITY_EXTRA_HIGH, 2_000);

    // The re-queued item gets a fresh index, so it cannot tie with itself or
    // order behind an entry that no longer exists.
    let entry = queue.pop().expect("the queue holds the item again");
    assert_eq!(entry.item, "item");
    assert_eq!(entry.key.priority, PRIORITY_EXTRA_HIGH);
    assert_eq!(entry.key.index, 1);
    assert!(queue.is_empty());
}

#[test]
fn a_queue_holds_the_whole_input_order_however_the_items_arrive() {
    let mut queue = IndexedQueue::new();
    for (item, priority, timestamp) in [
        ("h", PRIORITY_HIGH, 30),
        ("d", PRIORITY_LOW, 10),
        ("x", PRIORITY_EXTRA_HIGH, 50),
        ("m1", PRIORITY_MEDIUM, 20),
        ("m2", PRIORITY_MEDIUM, 20),
        ("m3", PRIORITY_MEDIUM, 5),
        ("e", PRIORITY_LOW, 0),
        ("m4", PRIORITY_MEDIUM, 20),
    ] {
        push(&mut queue, item, priority, timestamp);
    }

    // `m1` before `m2` before `m4` is the enqueue index tie-break on an
    // identical priority and timestamp, which only a queue that handed out
    // increasing indices at push time can produce.
    assert_eq!(
        items_of(dispatch_order(queue)),
        vec!["x", "h", "m3", "m1", "m2", "m4", "e", "d"]
    );
}

#[test]
fn a_push_without_a_timestamp_is_stamped_from_the_queue_clock() {
    let mut queue = IndexedQueue::new();
    let before = now_micros();

    queue
        .push("item", Some(PRIORITY_MEDIUM), None)
        .expect("the push is accepted");

    let entry = queue.pop().expect("the queue holds the item");
    assert!(entry.key.timestamp_micros >= before);
    assert!(entry.key.timestamp_micros <= now_micros());
}
