use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use tokio::sync::broadcast;

use crate::score_events::{initial_snapshot, publish_changes, Snapshot};
use crate::store::{entity_is_shown, EntityKind, StoreError};
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

/// One server-sent event in the shape the Python server emitted: an id that reads
/// as microseconds since the epoch in hexadecimal — bumped one microsecond when the
/// clock repeats itself, so it still names exactly one event (see `next_id`) — the
/// entity kind as the event name, and "<operation> <key>" as the data.
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

/// The id is a cursor, not a clock reading: `since()` orders events by it, and a
/// replay silently drops every event it cannot prove came after the client's
/// boundary. Wall-clock microseconds repeat when two publishes land in the same
/// tick — the clock is therefore only a floor, and a repeated tick is bumped one
/// microsecond past it, which is what keeps an id naming exactly one event while it
/// still reads as a hexadecimal microsecond count.
fn next_id() -> String {
    static LAST_ISSUED: AtomicU64 = AtomicU64::new(0);
    let now = match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(elapsed) => elapsed.as_micros() as u64,
        Err(_) => 0,
    };
    // CAS loop rather than `fetch_update`: CI builds on the newest stable while this
    // tree also has to compile on older toolchains, and `fetch_update` was renamed to
    // `try_update` in between — a deprecation that `-D warnings` turns into a failure.
    let mut previous = LAST_ISSUED.load(Ordering::Relaxed);
    let id = loop {
        let candidate = previous.max(now) + 1;
        match LAST_ISSUED.compare_exchange_weak(
            previous,
            candidate,
            Ordering::Relaxed,
            Ordering::Relaxed,
        ) {
            Ok(_) => break candidate,
            Err(observed) => previous = observed,
        }
    };
    format!("{id:x}")
}

/// The entity kind a projection table feeds, so the event name stays what the page
/// already switches on instead of leaking the table name.
pub fn entity_kind(table: &str) -> &str {
    match EntityKind::of_table(table) {
        Some(kind) => kind.event_name(),
        // The score tables name themselves: no entity event is published for them, but the
        // mapping stays total so a caller never has to guess.
        None => match table {
            "ranking_submissions" => "submission",
            "ranking_subchanges" => "subchange",
            other => other,
        },
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
        let channel = notification.channel().to_string();
        announce(state, &pool, &channel, &payload).await?;
        let next = publish_changes(state, snapshot).await?;
        *snapshot = next;
    }
}

/// One notification, as the page hears it: the shared board is dropped and the change is
/// announced to the page only when the page draws the entity it names.
///
/// WHY this is public: the publication boundary is where a change to a contest the operator does
/// not show used to reach a page drawing another one, and a rule about what may be published is
/// proved by publishing into a live projection rather than by racing the notifier's delivery.
///
/// WHY the cache is dropped before the decision and for every notification: the entity scope
/// above is one question about the projection, while the board's contents are another — a change
/// to a table the page hears nothing about can still move a score.
pub async fn announce(
    state: &AppState,
    pool: &sqlx::postgres::PgPool,
    channel: &str,
    payload: &str,
) -> Result<(), StoreError> {
    let mut parts = payload.splitn(3, ' ');
    let table = parts.next().unwrap_or_default();
    let operation = parts.next().unwrap_or_default();
    let key = parts.next().unwrap_or_default();

    state.invalidate_standings().await;

    // Python's DataWatcher registered score callbacks but no submission or
    // subchange callbacks, so those two tables move scores and publish nothing
    // else; an entity event there would name something the page cannot read.
    // Settings and overrides come over ranking_control, the entity events the page
    // switches on come over ranking_entities.
    if channel == "ranking_control" {
        state.feed().publish("control", payload.to_string());
    } else if !affects_scores(table) && announced(pool, table, operation, key).await? {
        state.feed().publish(
            entity_kind(table),
            format!("{} {key}", operation_name(operation)),
        );
    }
    Ok(())
}

/// Whether a projection change is the page's to hear.
///
/// WHY the scope is asked here and not only at the read: an entity event names the key it is
/// about, so publishing a change to a contest the config does not show hands a page drawing
/// another contest the name of something it never draws. The read refuses exactly the same keys
/// (both ask [`entity_is_shown`]), so an announcable key and a readable key are one set.
///
/// WHY a delete is announced without asking the scope: the notifier reports the key of a row
/// that is already gone, so the projection the scope is read from can no longer say which
/// contest it belonged to. Suppressing it would strand an entity the board does draw — a column
/// whose task was deleted — while announcing it can only name a key the page never held, which
/// its listener discards as a no-op. This is the one case the projection cannot answer, and it
/// is covered by the read predicate rather than by this check.
async fn announced(
    pool: &sqlx::postgres::PgPool,
    table: &str,
    operation: &str,
    key: &str,
) -> Result<bool, StoreError> {
    if operation == "delete" {
        return Ok(true);
    }
    match EntityKind::of_table(table) {
        Some(kind) => entity_is_shown(pool, kind, key).await,
        // A table the projection does not scope keeps the event that names it as it is.
        None => Ok(true),
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
