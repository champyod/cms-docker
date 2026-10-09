use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use tokio::sync::broadcast;

use crate::db::Db;

/// How many events a client that reconnects with a last-event-id may replay. The
/// Python server sized this from config.buffer_size, default 100.
pub const CACHE_SIZE: usize = 100;

/// Slow subscribers are dropped rather than allowed to stall the publisher; the
/// live scoreboard is refreshed by a reinit, which costs one round trip.
const CHANNEL_CAPACITY: usize = 256;

/// One server-sent event, in the shape the Python server emitted: an id that is
/// microseconds since the epoch in hexadecimal, the entity kind as the event name,
/// and "<operation> <key>" as the data.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RankingEvent {
    pub id: String,
    pub name: String,
    pub data: String,
}

impl RankingEvent {
    pub fn frame(&self) -> String {
        format!(
            "id:{}\nevent:{}\ndata:{}\n\n",
            self.id, self.name, self.data
        )
    }
}

#[derive(Clone)]
pub struct Feed {
    inner: Arc<FeedInner>,
}

struct FeedInner {
    sender: broadcast::Sender<RankingEvent>,
    cache: Mutex<VecDeque<RankingEvent>>,
}

impl Default for Feed {
    fn default() -> Self {
        Self::new()
    }
}

impl Feed {
    pub fn new() -> Self {
        let (sender, _) = broadcast::channel(CHANNEL_CAPACITY);
        Self {
            inner: Arc::new(FeedInner {
                sender,
                cache: Mutex::new(VecDeque::with_capacity(CACHE_SIZE)),
            }),
        }
    }

    pub fn publish(&self, name: &str, data: String) -> RankingEvent {
        let event = RankingEvent {
            id: next_id(),
            name: name.to_string(),
            data,
        };
        if let Ok(mut cache) = self.inner.cache.lock() {
            if cache.len() == CACHE_SIZE {
                cache.pop_front();
            }
            cache.push_back(event.clone());
        }
        // Nobody listening is the normal case between contests.
        let _ = self.inner.sender.send(event.clone());
        event
    }

    pub fn subscribe(&self) -> broadcast::Receiver<RankingEvent> {
        self.inner.sender.subscribe()
    }

    pub fn cached(&self) -> Vec<RankingEvent> {
        self.inner
            .cache
            .lock()
            .map(|cache| cache.iter().cloned().collect())
            .unwrap_or_default()
    }

    /// What a reconnecting client missed: None when the cache cannot cover the gap,
    /// which is the case the Python server answered with a reinit rather than a
    /// silently truncated history.
    pub fn since(&self, last_event_id: Option<&str>) -> Option<Vec<RankingEvent>> {
        let Some(last_event_id) = last_event_id else {
            return Some(Vec::new());
        };
        let Ok(last) = u64::from_str_radix(last_event_id, 16) else {
            return Some(Vec::new());
        };
        let cached = self.cached();
        let Some(oldest) = cached.first() else {
            return Some(Vec::new());
        };
        let oldest_key = u64::from_str_radix(&oldest.id, 16).unwrap_or(u64::MAX);
        if last < oldest_key {
            return None;
        }
        Some(
            cached
                .into_iter()
                .filter(|event| u64::from_str_radix(&event.id, 16).is_ok_and(|key| key > last))
                .collect(),
        )
    }
}

fn next_id() -> String {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(elapsed) => format!("{:x}", elapsed.as_micros()),
        Err(_) => "0".to_string(),
    }
}

/// The entity kind a projection table feeds, so the event name stays what the page
/// already switches on instead of leaking the table name.
pub fn entity_kind(table: &str) -> &str {
    match table {
        "ranking_contests" => "contest",
        "ranking_tasks" => "task",
        "ranking_teams" => "team",
        "ranking_users" => "user",
        "ranking_submissions" => "submission",
        "ranking_subchanges" => "subchange",
        other => other,
    }
}

/// Listens for the triggers' notifications and publishes them. NOTIFY has no
/// replay: a listener that was disconnected cannot know what it missed, so it
/// publishes a reinit and the page refetches, which is the same signal the Python
/// server sent when its own cache could not cover a gap.
pub async fn listen(db: Db, feed: Feed) {
    loop {
        if let Err(error) = listen_once(&db, &feed).await {
            eprintln!("cms-ranking: event listener reconnecting: {error}");
        }
        feed.publish("reinit", "gap".to_string());
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    }
}

async fn listen_once(db: &Db, feed: &Feed) -> Result<(), sqlx::Error> {
    let mut listener = sqlx::postgres::PgListener::connect_with(db.pool()).await?;
    listener.listen("ranking_entities").await?;
    listener.listen("ranking_control").await?;
    loop {
        let notification = listener.recv().await?;
        if notification.channel() == "ranking_control" {
            feed.publish("control", notification.payload().to_string());
            continue;
        }
        let payload = notification.payload();
        let mut parts = payload.splitn(3, ' ');
        let table = parts.next().unwrap_or_default();
        let operation = parts.next().unwrap_or_default();
        let key = parts.next().unwrap_or_default();
        feed.publish(entity_kind(table), format!("{operation} {key}"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_frame_matches_the_python_wire_format() {
        let event = RankingEvent {
            id: "17a1b2c3d4e5".to_string(),
            name: "task".to_string(),
            data: "create t0".to_string(),
        };
        assert_eq!(
            event.frame(),
            "id:17a1b2c3d4e5\nevent:task\ndata:create t0\n\n"
        );
    }

    #[test]
    fn a_client_with_no_last_id_replays_nothing() {
        let feed = Feed::new();
        feed.publish("task", "create t0".to_string());
        assert_eq!(feed.since(None), Some(Vec::new()));
    }

    #[test]
    fn a_client_replays_only_what_it_missed() {
        let feed = Feed::new();
        let first = feed.publish("task", "create t0".to_string());
        feed.publish("team", "create m0".to_string());
        let replayed = feed
            .since(Some(&first.id))
            .expect("the cache covers the gap");
        assert_eq!(replayed.len(), 1);
        assert_eq!(replayed[0].name, "team");
    }

    #[test]
    fn a_gap_the_cache_cannot_cover_asks_for_a_reinit() {
        let feed = Feed::new();
        for index in 0..(CACHE_SIZE + 5) {
            feed.publish("task", format!("create t{index}"));
        }
        assert_eq!(feed.since(Some("1")), None);
    }

    #[tokio::test]
    async fn a_subscriber_receives_what_is_published_after_it_subscribed() {
        let feed = Feed::new();
        let mut receiver = feed.subscribe();
        feed.publish("user", "update u0".to_string());
        let event = receiver.recv().await.expect("the event arrives");
        assert_eq!(event.name, "user");
        assert_eq!(event.data, "update u0");
    }

    #[test]
    fn a_projection_table_maps_to_the_entity_kind_the_page_knows() {
        assert_eq!(entity_kind("ranking_subchanges"), "subchange");
        assert_eq!(entity_kind("ranking_contests"), "contest");
        assert_eq!(entity_kind("something_else"), "something_else");
    }
}
