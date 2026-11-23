//! The RPC surface every service inherits, composed onto the table it adds itself.
//!
//! `start_backdoor` and `stop_backdoor` need no entry here: the gate refuses them before dispatch.

use std::sync::{Mutex, MutexGuard};

use cms_proto::Method;
use serde_json::Value;

use crate::Stop;

/// The name `echo` is served under, as `service.py:371` spells it.
const ECHO_METHOD: &str = "echo";

/// The name `quit` is served under, as `service.py:381` spells it.
const QUIT_METHOD: &str = "quit";

/// The one argument `echo` reads.
const STRING_ARGUMENT: &str = "string";

/// The argument naming why the service was asked to stop.
const REASON_ARGUMENT: &str = "reason";

/// The argument asking for a non-zero exit, so a supervisor restarts the service.
const FATAL_ARGUMENT: &str = "fatal";

/// Said when `quit` runs before a host attached its stop.
const UNATTACHED: &str =
    "quit has no host to stop; attach the host's stop handle with service::attach_stop";

/// Said when a panic left the stop slot unusable.
const POISONED: &str = "the stop slot is unusable after a panic while it was held";

/// The stop `quit` raises, empty until a composition root attaches its host's.
///
/// `quit` ignores the context it is handed: the stop is attached here, once,
/// before any call can arrive, and one process serves one service.
static STOP: Mutex<Option<Stop>> = Mutex::new(None);

/// The methods every service answers, ready to compose with the ones it adds.
///
/// Generic over the context so a service that carries state can compose them
/// with its own table instead of being pinned to the unit type.
#[must_use]
pub fn methods<C>() -> Vec<Method<C>> {
    vec![
        Method {
            name: ECHO_METHOD,
            is_callable: true,
            handler: echo,
        },
        Method {
            name: QUIT_METHOD,
            is_callable: true,
            handler: quit,
        },
    ]
}

/// Makes `quit` stop this host: the composition root calls it once, right after `Host::bind`.
///
/// # Errors
///
/// [`POISONED`] when a panic left the slot unusable.
pub fn attach_stop(stop: Stop) -> Result<(), String> {
    *slot()? = Some(stop);
    Ok(())
}

/// `echo`: the argument back, unchanged — the probe the CLI and the tests read liveness from.
fn echo<C>(data: &Value, _context: &C) -> Result<Value, String> {
    // WHY: the Python method annotates `str` and checks nothing, so a caller gets back what it sent.
    data.get(STRING_ARGUMENT).cloned().ok_or_else(|| {
        format!("{ECHO_METHOD}() missing 1 required positional argument: '{STRING_ARGUMENT}'")
    })
}

/// `quit`: names the reason, then stops the host, fatally when asked.
fn quit<C>(data: &Value, _context: &C) -> Result<Value, String> {
    let reason = data
        .get(REASON_ARGUMENT)
        .and_then(Value::as_str)
        .unwrap_or_default();
    let is_fatal = data
        .get(FATAL_ARGUMENT)
        .and_then(Value::as_bool)
        .unwrap_or(false);
    // WHY: the process is about to end, so the reason goes to stderr, the one channel the supervisor keeps.
    eprintln!("Trying to exit as asked by another service ({reason}).");
    let stop = slot()?
        .as_ref()
        .ok_or_else(|| UNATTACHED.to_owned())?
        .clone();
    if is_fatal {
        stop.request_fatally();
    } else {
        stop.request();
    }
    Ok(Value::Null)
}

fn slot() -> Result<MutexGuard<'static, Option<Stop>>, String> {
    STOP.lock().map_err(|_| POISONED.to_owned())
}
