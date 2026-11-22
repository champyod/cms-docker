//! The record `Log` receives, read with `logging.LogRecord`'s own defaults.
//!
//! `msecs` is read apart from `created` because `formatTime` prints that field, and the transport sends both.

use serde_json::{Map, Value};

/// The thread name `logging.LogRecord` fills in when the record carries none.
const DEFAULT_THREAD_NAME: &str = "MainThread";

/// The wire keys one record carries, spelled as `logging.LogRecord` attributes.
const MSG_KEY: &str = "msg";
const LEVELNAME_KEY: &str = "levelname";
const LEVELNO_KEY: &str = "levelno";
const CREATED_KEY: &str = "created";
const MSECS_KEY: &str = "msecs";
const SERVICE_NAME_KEY: &str = "service_name";
const SERVICE_SHARD_KEY: &str = "service_shard";
const OPERATION_KEY: &str = "operation";
const EXC_TEXT_KEY: &str = "exc_text";
const THREAD_NAME_KEY: &str = "threadName";
const FILENAME_KEY: &str = "filename";
const FUNC_NAME_KEY: &str = "funcName";

/// Why a `__data` object is not a record the formatter can draw.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecordError {
    /// The arguments handed to `Log` were not a JSON object.
    NotAnObject,
    /// A field the formatter reads unconditionally is absent or of the wrong type.
    Missing(&'static str),
    /// A field the formatter reads only when present carries the wrong type.
    Malformed(&'static str),
}

impl std::fmt::Display for RecordError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotAnObject => write!(formatter, "log record arguments are not a JSON object"),
            Self::Missing(field) => write!(
                formatter,
                "log record field `{field}` is absent or has the wrong type"
            ),
            Self::Malformed(field) => {
                write!(formatter, "log record field `{field}` has the wrong type")
            }
        }
    }
}

impl std::error::Error for RecordError {}

/// One record as the wire delivers it, with the defaults `makeLogRecord` fills in.
#[derive(Debug, Clone, PartialEq)]
pub struct Record {
    pub(crate) msg: String,
    pub(crate) levelname: String,
    pub(crate) levelno: i64,
    pub(crate) created: f64,
    pub(crate) msecs: Option<f64>,
    pub(crate) service_name: Option<String>,
    pub(crate) service_shard: Option<i64>,
    pub(crate) operation: Option<String>,
    pub(crate) exc_text: Option<String>,
    pub(crate) thread_name: String,
    pub(crate) filename: String,
    pub(crate) func_name: Option<String>,
}

impl Record {
    /// Reads the keyword arguments of one `Log` call.
    ///
    /// # Errors
    ///
    /// [`RecordError`] naming the first field whose type the Python record could not hold.
    pub fn from_json(data: &Value) -> Result<Self, RecordError> {
        let object = data.as_object().ok_or(RecordError::NotAnObject)?;
        Ok(Self {
            msg: required_string(object, MSG_KEY)?,
            levelname: required_string(object, LEVELNAME_KEY)?,
            levelno: required_integer(object, LEVELNO_KEY)?,
            created: required_number(object, CREATED_KEY)?,
            msecs: optional_number(object, MSECS_KEY)?,
            service_name: optional_string(object, SERVICE_NAME_KEY)?,
            service_shard: optional_integer(object, SERVICE_SHARD_KEY)?,
            operation: optional_string(object, OPERATION_KEY)?,
            exc_text: optional_string(object, EXC_TEXT_KEY)?,
            thread_name: optional_string(object, THREAD_NAME_KEY)?
                .unwrap_or_else(|| DEFAULT_THREAD_NAME.to_owned()),
            filename: optional_string(object, FILENAME_KEY)?.unwrap_or_default(),
            func_name: optional_string(object, FUNC_NAME_KEY)?,
        })
    }
}

fn required_string(object: &Map<String, Value>, key: &'static str) -> Result<String, RecordError> {
    object
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or(RecordError::Missing(key))
}

fn required_integer(object: &Map<String, Value>, key: &'static str) -> Result<i64, RecordError> {
    object
        .get(key)
        .and_then(Value::as_i64)
        .ok_or(RecordError::Missing(key))
}

fn required_number(object: &Map<String, Value>, key: &'static str) -> Result<f64, RecordError> {
    object
        .get(key)
        .and_then(Value::as_f64)
        .ok_or(RecordError::Missing(key))
}

fn optional_string(
    object: &Map<String, Value>,
    key: &'static str,
) -> Result<Option<String>, RecordError> {
    match object.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(text)) => Ok(Some(text.clone())),
        Some(_) => Err(RecordError::Malformed(key)),
    }
}

fn optional_integer(
    object: &Map<String, Value>,
    key: &'static str,
) -> Result<Option<i64>, RecordError> {
    match object.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value.as_i64().map(Some).ok_or(RecordError::Malformed(key)),
    }
}

fn optional_number(
    object: &Map<String, Value>,
    key: &'static str,
) -> Result<Option<f64>, RecordError> {
    match object.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value.as_f64().map(Some).ok_or(RecordError::Malformed(key)),
    }
}
