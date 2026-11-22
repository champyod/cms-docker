//! The resource service's RPC methods, answered by the thread that owns the service.

use std::sync::mpsc::{channel, Sender};
use std::sync::{Mutex, MutexGuard};

use cms_proto::Method;
use serde_json::{json, Value};

use super::service::ResourceService;
use crate::service;

/// The name `get_resources` is served under, as `ResourceService.py:404` spells it.
const GET_RESOURCES_METHOD: &str = "get_resources";

/// The name `toggle_autorestart` is served under, as `ResourceService.py:448` spells it.
const TOGGLE_AUTORESTART_METHOD: &str = "toggle_autorestart";

/// The argument naming the caller's last sample, which defaults to the whole window.
const LAST_TIME_ARGUMENT: &str = "last_time";

/// The argument naming the service to flip, spelled `Name,shard`.
const SERVICE_ARGUMENT: &str = "service";

/// Said when a handler runs before a daemon installed its mailbox.
const NOT_RUNNING: &str = "the resource service is not running in this process";

/// Said when the caller dropped the reply it asked for.
const CALLER_GONE: &str = "the caller that asked is gone";

/// Said when a panic left the mailbox unusable.
const POISONED: &str = "the resource mailbox is unusable after a panic while it was held";

/// The mailbox the handlers post to, empty until a daemon installs one.
static MAILBOX: Mutex<Option<Sender<Request>>> = Mutex::new(None);

/// One question the wire asks the thread that owns the service.
///
/// The service holds a `&dyn ResourceReader` and the children it spawned, so it is not `Send`
/// and no connection thread may touch it. The handlers are bare `fn`s with no captured state,
/// so the one channel is how a thread that did not build the service still gets an answer.
pub struct Request {
    question: Question,
}

/// What the answer is, and where it goes.
enum Question {
    /// The samples newer than `last_time`, as `get_resources` returns them.
    GetResources {
        last_time: f64,
        reply: Sender<Vec<Value>>,
    },
    /// One service's restart flag flipped, or why it could not be.
    ToggleAutorestart {
        service: String,
        reply: Sender<Result<Option<bool>, String>>,
    },
}

impl Request {
    /// Answers on the thread that owns `service`, at the instant that thread reads `now`.
    pub(super) fn answer(self, service: &mut ResourceService<'_>, now: f64) -> Result<(), String> {
        match self.question {
            Question::GetResources { last_time, reply } => {
                let samples: Vec<Value> = service
                    .get_resources(last_time, now)
                    .iter()
                    .map(|(time, sample)| json!([time, sample.to_json()]))
                    .collect();
                reply.send(samples).map_err(|_| CALLER_GONE.to_owned())
            }
            Question::ToggleAutorestart {
                service: name,
                reply,
            } => reply
                .send(
                    service
                        .toggle_autorestart(&name)
                        .map_err(|error| error.to_string()),
                )
                .map_err(|_| CALLER_GONE.to_owned()),
        }
    }
}

/// The methods this service answers, ready for [`Host::bind`](crate::Host::bind), the base ones first.
#[must_use]
pub fn methods() -> Vec<Method> {
    let mut methods = service::methods();
    methods.push(Method {
        name: GET_RESOURCES_METHOD,
        is_callable: true,
        handler: get_resources,
    });
    methods.push(Method {
        name: TOGGLE_AUTORESTART_METHOD,
        is_callable: true,
        handler: toggle_autorestart,
    });
    methods
}

/// Makes `mailbox` the one the handlers post to, replacing whatever was there.
///
/// # Errors
///
/// [`POISONED`] when a panic left the slot unusable.
pub fn install(mailbox: Sender<Request>) -> Result<(), String> {
    *slot()? = Some(mailbox);
    Ok(())
}

/// `get_resources`: every stored sample newer than `last_time`, as `(time, sample)` pairs.
fn get_resources(data: &Value) -> Result<Value, String> {
    // WHY: Python's default is 0.0, which the service then floors at the retention window.
    let last_time = data
        .get(LAST_TIME_ARGUMENT)
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let (reply, answer) = channel();
    post(Request {
        question: Question::GetResources { last_time, reply },
    })?;
    answer
        .recv()
        .map(Value::Array)
        .map_err(|_| NOT_RUNNING.to_owned())
}

/// `toggle_autorestart`: flips one service's flag and answers what it is now, `null` when off.
fn toggle_autorestart(data: &Value) -> Result<Value, String> {
    let name = data
        .get(SERVICE_ARGUMENT)
        .and_then(Value::as_str)
        .ok_or_else(|| {
            format!(
                "{TOGGLE_AUTORESTART_METHOD}() missing 1 required positional argument: \
                 '{SERVICE_ARGUMENT}'"
            )
        })?;
    let (reply, answer) = channel();
    post(Request {
        question: Question::ToggleAutorestart {
            service: name.to_owned(),
            reply,
        },
    })?;
    let flag = answer.recv().map_err(|_| NOT_RUNNING.to_owned())??;
    Ok(json!(flag))
}

/// Sends one question to the thread that owns the service, releasing the slot before waiting.
fn post(request: Request) -> Result<(), String> {
    slot()?
        .as_ref()
        .ok_or_else(|| NOT_RUNNING.to_owned())?
        .send(request)
        .map_err(|_| NOT_RUNNING.to_owned())
}

fn slot() -> Result<MutexGuard<'static, Option<Sender<Request>>>, String> {
    MAILBOX.lock().map_err(|_| POISONED.to_owned())
}
