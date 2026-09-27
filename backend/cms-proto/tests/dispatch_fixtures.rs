//! The service table and the messages both gate suites dispatch under.
//!
//! Each test target is a crate of its own, so this module is the one place the
//! two can read the same table from. The handlers answer with a value of their
//! own, so a refusal that comes back with a null `__data` is itself the proof
//! that none of them ran.

use cms_proto::{Decision, GateConfig, Method, Response};
use serde_json::{json, Value};

/// The correlation id every message here carries.
pub const REQUEST: &str = "req-1";

/// The secret the service under test is configured with.
pub const SECRET: &str = "correct-horse-battery-staple";

/// A service exposing two callable methods, one that fails, two backdoor
/// methods, and one that exists without being callable.
pub const SERVICE: [Method; 5] = [
    Method {
        name: "get_status",
        is_callable: true,
        handler: echo,
    },
    Method {
        name: "get_log",
        is_callable: true,
        handler: refuse,
    },
    Method {
        name: "start_backdoor",
        is_callable: true,
        handler: echo,
    },
    Method {
        name: "stop_backdoor",
        is_callable: true,
        handler: echo,
    },
    Method {
        name: "reset_connection",
        is_callable: false,
        handler: echo,
    },
];

/// Answers with the arguments it was called with, the way a keyword-argument
/// call does: a `__data` that is not an object cannot be splatted, so it is
/// refused by the handler rather than by the gate.
pub fn echo(data: &Value) -> Result<Value, String> {
    data.as_object()
        .map(|_| data.clone())
        .ok_or_else(|| "__data must be an object".to_owned())
}

/// Answers with a failure of its own wording, since a handler in another
/// language has no Python class name and traceback to format.
pub fn refuse(_data: &Value) -> Result<Value, String> {
    Err("no log for this shard".to_owned())
}

/// The gate settings a test dispatches under.
pub const fn gate(secret: Option<&'static str>, is_backdoor_enabled: bool) -> GateConfig<'static> {
    GateConfig {
        secret,
        is_backdoor_enabled,
    }
}

/// A well-formed message naming `method`, with one argument and the secret.
pub fn message(method: &str) -> Value {
    json!({
        "__id": REQUEST,
        "__method": method,
        "__data": {"limit": 3},
        "__secret": SECRET,
    })
}

/// The decision for a message that was refused, carrying the refusal and no
/// result beside it: the null `__data` is what proves no handler ran.
pub fn refused(reason: &str) -> Decision {
    Decision::Answered(Response {
        id: REQUEST.to_owned(),
        data: Value::Null,
        error: Some(json!(reason)),
    })
}
