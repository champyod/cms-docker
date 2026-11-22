//! The two methods the wire serves, and the one sink they share.
//!
//! `cms_proto::Method` carries a bare `fn`, so the sink lives in one process-global slot; a second `LogService` takes it over.

use std::sync::{Mutex, MutexGuard};

use serde_json::Value;

use super::sink::Sink;

/// Said when a handler runs before any service installed a sink.
const NOT_INSTALLED: &str = "no log sink is installed in this process";

/// Said when a record failed while holding the slot, so the next reader is not told it is intact.
const POISONED: &str = "the log sink is unusable after a record failed mid-write";

/// The sink this process serves `Log` through, empty until a service is built.
static SINK: Mutex<Option<Sink>> = Mutex::new(None);

/// Makes `sink` the one the handlers serve, replacing whatever was there.
///
/// # Errors
///
/// [`POISONED`] when an earlier record panicked while holding the slot.
pub(crate) fn install(sink: Sink) -> Result<(), String> {
    *slot()? = Some(sink);
    Ok(())
}

/// `Log`: draws the record into both outputs and answers with nothing.
pub(crate) fn log_method(data: &Value) -> Result<Value, String> {
    let record = super::record::Record::from_json(data).map_err(|error| error.to_string())?;
    with_sink(|sink| {
        sink.record(&record)
            .map_err(|error| format!("cannot write the log record: {error}"))
    })?;
    Ok(Value::Null)
}

/// `last_messages`: the buffer, oldest first, taking no arguments.
pub(crate) fn last_messages_method(_data: &Value) -> Result<Value, String> {
    with_sink(|sink| Ok(Value::Array(sink.last_messages())))
}

/// Runs one action against the installed sink, or says why there is none to run.
fn with_sink<T>(action: impl FnOnce(&mut Sink) -> Result<T, String>) -> Result<T, String> {
    let mut slot = slot()?;
    let sink = slot.as_mut().ok_or_else(|| NOT_INSTALLED.to_owned())?;
    action(sink)
}

fn slot() -> Result<MutexGuard<'static, Option<Sink>>, String> {
    SINK.lock().map_err(|_| POISONED.to_owned())
}
