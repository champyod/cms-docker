//! The last warnings a service remembers, in the shape `last_messages` returns them.
//!
//! The coordinates here are the raw service pair, not the formatter's shortened one (`LogService.py:107-118`).

use std::collections::VecDeque;

use serde_json::{json, Value};

use super::record::Record;

/// How many entries the buffer keeps: `LogService.LAST_MESSAGES_COUNT`.
const CAPACITY: usize = 100;

/// The warnings worth remembering, oldest first, with the oldest dropped at the cap.
#[derive(Debug, Default)]
pub struct RecentMessages {
    entries: VecDeque<Value>,
}

impl RecentMessages {
    /// Keeps one record, dropping the oldest entry once the buffer is full.
    pub fn push(&mut self, record: &Record) {
        if self.entries.len() == CAPACITY {
            self.entries.pop_front();
        }
        self.entries.push_back(entry(record));
    }

    /// The entries oldest first, copied so the caller keeps its own answer.
    #[must_use]
    pub fn snapshot(&self) -> Vec<Value> {
        self.entries.iter().cloned().collect()
    }
}

/// The six keys one buffered entry carries, and nothing else.
fn entry(record: &Record) -> Value {
    json!({
        "message": record.msg,
        "coord": coordinates(record),
        "operation": record.operation.clone().unwrap_or_default(),
        "severity": record.levelname,
        "timestamp": record.created,
        "exc_text": record.exc_text,
    })
}

/// The service pair joined by a comma when both halves are there, else empty.
fn coordinates(record: &Record) -> String {
    match (&record.service_name, record.service_shard) {
        (Some(name), Some(shard)) => format!("{name},{shard}"),
        _ => String::new(),
    }
}
