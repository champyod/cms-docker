//! The event wire format, checked without a server: block framing, the cache's
//! replay decision, and the vocabulary the feed maps onto.

use std::collections::BTreeMap;

use cms_ranking::feed::{entity_kind, Feed, RankingEvent, CACHE_SIZE, REINIT};
use cms_ranking::score_events::{python_float, score_changes};

fn event(name: &str, data: &str) -> RankingEvent {
    RankingEvent {
        id: "65d6788bc1010".to_string(),
        name: name.to_string(),
        data: data.to_string(),
    }
}

#[test]
fn a_block_is_id_event_data_and_a_blank_line() {
    assert_eq!(
        event("task", "create t0").frame(),
        "id:65d6788bc1010\nevent:task\ndata:create t0\n\n"
    );
}

#[test]
fn the_event_line_is_omitted_for_the_default_message_name() {
    assert_eq!(
        event("message", "create t0").frame(),
        "id:65d6788bc1010\ndata:create t0\n\n"
    );
}

#[test]
fn every_data_line_gets_its_own_prefix() {
    assert_eq!(
        event("score", "u0\nt0").frame(),
        "id:65d6788bc1010\nevent:score\ndata:u0\ndata:t0\n\n"
    );
}

#[test]
fn reinit_carries_neither_an_id_nor_data() {
    assert_eq!(REINIT, b"event:reinit\n\n");
    let text = String::from_utf8(REINIT.to_vec()).expect("reinit is utf-8");
    assert!(!text.contains("id:"));
    assert!(!text.contains("data:"));
}

#[test]
fn a_normal_connect_replays_nothing_rather_than_a_reinit() {
    let feed = Feed::new();
    feed.publish("task", "create t0".to_string());
    assert_eq!(feed.since(None), Some(Vec::new()));
}

#[test]
fn a_stale_id_is_the_only_reinit_trigger() {
    let feed = Feed::new();
    for index in 0..(CACHE_SIZE + 5) {
        feed.publish("task", format!("create t{index}"));
    }
    assert_eq!(feed.since(Some("1")), None);
}

#[test]
fn a_recent_id_replays_only_what_it_missed() {
    let feed = Feed::new();
    let first = feed.publish("task", "create t0".to_string());
    feed.publish("score", "u0 t0 50.0".to_string());
    let replayed = feed
        .since(Some(&first.id))
        .expect("the cache covers the gap");
    assert!(replayed.iter().all(|event| event.id != first.id));
    assert!(replayed.iter().any(|event| event.name == "score"));
}

#[test]
fn the_projection_table_names_map_to_the_page_vocabulary() {
    assert_eq!(entity_kind("ranking_contests"), "contest");
    assert_eq!(entity_kind("ranking_tasks"), "task");
    assert_eq!(entity_kind("ranking_teams"), "team");
    assert_eq!(entity_kind("ranking_users"), "user");
}

#[test]
fn a_score_event_frames_with_the_captured_bytes() {
    assert_eq!(
        event("score", "u0 t0 50.0").frame(),
        "id:65d6788bc1010\nevent:score\ndata:u0 t0 50.0\n\n"
    );
}

#[test]
fn a_score_keeps_pythons_decimal_point() {
    assert_eq!(python_float(100.0), "100.0");
    assert_eq!(python_float(30.5), "30.5");
}

#[test]
fn only_scores_that_moved_become_events() {
    let previous = BTreeMap::from([
        (("u0".to_string(), "t0".to_string()), 50.0),
        (("u1".to_string(), "t1".to_string()), 30.0),
    ]);
    let next = BTreeMap::from([
        (("u0".to_string(), "t0".to_string()), 100.0),
        (("u1".to_string(), "t1".to_string()), 30.0),
        (("u2".to_string(), "t2".to_string()), 10.0),
    ]);
    assert_eq!(
        score_changes(&previous, &next),
        vec![
            ("u0".to_string(), "t0".to_string(), 100.0),
            ("u2".to_string(), "t2".to_string(), 10.0),
        ]
    );
}

#[test]
fn a_score_that_leaves_the_board_is_reported_as_zero() {
    let previous = BTreeMap::from([(("u0".to_string(), "t0".to_string()), 50.0)]);
    assert_eq!(
        score_changes(&previous, &BTreeMap::new()),
        vec![("u0".to_string(), "t0".to_string(), 0.0)]
    );
}
