use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use tokio::sync::broadcast;

use crate::score_events::{initial_snapshot, publish_changes, Snapshot};
use crate::store::StoreError;
use crate::AppState;

/// How many events a client that reconnects with a last-event-id may replay. The
/// Python server sized this from config.buffer_size, default 100.
pub const CACHE_SIZE: usize = 100;

/// Slow subscribers are dropped rather than allowed to stall the publisher; the
/// connection ends and the reconnect, with a Last-Event-ID, is the replay path.
const CHANNEL_CAPACITY: usize = 256;

/// A comment line is what the Python stream opens with and what it writes when the
/// connection would otherwise be idle. An SSE client discards it.
pub const COMMENT: &[u8] = b":\n";

/// The only reinit the baseline ever sends: a Last-Event-ID the cache cannot cover.
/// It carries an empty data line, because a block without one is discarded before it
/// is dispatched, and no id, because a reinit moves the client's cursor nowhere.
pub const REINIT: &[u8] = b"event:reinit\ndata:\n\n";

/// One server-sent event in the shape the Python server emitted: an id that is
/// microseconds since the epoch in hexadecimal, the entity kind as the event name,
/// and "<operation> <key>" as the data.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RankingEvent {
    pub id: String,
    pub name: String,
    pub data: String,
}

impl RankingEvent {
    /// Mirrors cmscommon.eventsource.format_event: the id always, the event line
    /// unless the name is the SSE default "message", one data line per payload
    /// line, and the blank line that closes the block.
    pub fn frame(&self) -> String {
        let mut lines = vec![format!("id:{}", self.id)];
        if self.name != "message" {
            lines.push(format!("event:{}", self.name));
        }
        lines.extend(self.data.split('\n').map(|line| format!("data:{line}")));
        format!("{}\n\n", lines.join("\n"))
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
    /// which is the single case the Python server answered with a reinit rather than
    /// a silently truncated history. A fresh connect replays nothing and is never a
    /// reinit.
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
        // A tombstone is a change to the user it hides, so it names the same kind
        // as the row it takes off the board.
        "ranking_hidden" => "user",
        "ranking_submissions" => "submission",
        "ranking_subchanges" => "subchange",
        other => other,
    }
}

/// Listens for the triggers' notifications and publishes them, turning a subchange
/// into the score events the page expects. NOTIFY has no replay, and a live
/// subscriber cannot ask for one, so a listener that reconnects stays silent: the
/// only reinit the contract allows is a stale Last-Event-ID on a fresh connection.
pub async fn listen(state: AppState) {
    let mut snapshot = initial_snapshot(&state).await;
    loop {
        if let Err(error) = listen_once(&state, &mut snapshot).await {
            eprintln!("cms-ranking: event listener reconnecting: {error}");
        }
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    }
}

async fn listen_once(state: &AppState, snapshot: &mut Snapshot) -> Result<(), StoreError> {
    let Some(pool) = state.db().map(|db| db.pool().clone()) else {
        return Ok(());
    };
    let mut listener = sqlx::postgres::PgListener::connect_with(&pool).await?;
    listener.listen("ranking_entities").await?;
    listener.listen("ranking_control").await?;
    loop {
        let notification = listener.recv().await?;
        let payload = notification.payload().to_string();
        let mut parts = payload.splitn(3, ' ');
        let table = parts.next().unwrap_or_default().to_string();
        let operation = parts.next().unwrap_or_default().to_string();
        let key = parts.next().unwrap_or_default().to_string();

        // Every projection change can move the board the page draws (names, teams,
        // membership, scores, settings or overrides), so the shared build is dropped
        // before anything is republished; the next read rebuilds it once.
        state.invalidate_standings().await;

        // Python's DataWatcher registered score callbacks but no submission or
        // subchange callbacks, so those two tables move scores and publish nothing
        // else; an entity event there would name something the page cannot read.
        // Settings and overrides come over ranking_control, the entity events the page
        // switches on come over ranking_entities.
        if notification.channel() == "ranking_control" {
            state.feed().publish("control", payload);
        } else if !affects_scores(&table) {
            state.feed().publish(
                entity_kind(&table),
                format!("{} {key}", operation_name(&operation)),
            );
        }

        let next = publish_changes(state, snapshot).await?;
        *snapshot = next;
    }
}

/// The two stores the Python scorer subscribed to; a change to either can move a
/// score, so either is a cue to recompute the board.
fn affects_scores(table: &str) -> bool {
    matches!(table, "ranking_submissions" | "ranking_subchanges")
}

/// The trigger reports the SQL verb; the page switches on the store verb the Python
/// callbacks used, and the capture is "create", not "insert".
fn operation_name(operation: &str) -> &str {
    match operation {
        "insert" => "create",
        other => other,
    }
}
