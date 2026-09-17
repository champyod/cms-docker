//! JSON envelope types for the CMS RPC protocol.
//!
//! These structs mirror the JSON dictionaries that `src/cms/io/rpc.py`
//! exchanges over the wire, so a Rust service and a Python service can
//! decode each other's messages without a translation layer. Field names
//! are the double-underscore names the Python side checks verbatim; any
//! mismatch there is a protocol break, not a style issue. Payloads are
//! opaque `serde_json::Value` because the Python side never inspects
//! `__data` inside the envelope layer.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Outgoing call: method name plus arguments, tagged with a unique id.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Request {
    #[serde(rename = "__id")]
    pub id: String,

    #[serde(rename = "__method")]
    pub method: String,

    #[serde(rename = "__data")]
    pub data: Value,

    /// The Python client omits this key entirely when no secret is
    /// configured, so it must be optional rather than an empty string.
    #[serde(rename = "__secret", skip_serializing_if = "Option::is_none")]
    pub secret: Option<String>,
}

/// Reply to a call: the echoed id, the result, and a null when no error.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Response {
    #[serde(rename = "__id")]
    pub id: String,

    #[serde(rename = "__data")]
    pub data: Value,

    /// Always serialized: the Python side indexes this key and relies on
    /// it being present (null on success) rather than absent.
    #[serde(rename = "__error", deserialize_with = "Option::<Value>::deserialize")]
    pub error: Option<Value>,
}

/// Convenience constructor: a request without authentication secret.
pub fn request(id: impl Into<String>, method: impl Into<String>, data: Value) -> Request {
    Request {
        id: id.into(),
        method: method.into(),
        data,
        secret: None,
    }
}

/// Convenience constructor: a success response (error serialized as null).
pub fn ok(id: impl Into<String>, data: Value) -> Response {
    Response {
        id: id.into(),
        data,
        error: None,
    }
}

/// Convenience constructor: an error response with the message string.
pub fn error(id: impl Into<String>, message: impl Into<String>) -> Response {
    Response {
        id: id.into(),
        data: Value::Null,
        error: Some(Value::String(message.into())),
    }
}
