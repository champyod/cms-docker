//! Strictly reads a returned worker job body into the fields a result writer stores.
//!
//! A worker returns the very same body it decoded, with the result keys stamped
//! over the build-time ones. [`worker_output`] reads only those result keys, by
//! name through [`JobKey`], and never the build-time keys it is not asked about.
//! Every key but `success` may be absent or null: the worker omits or nulls what
//! a run did not produce, so an absent or null key defaults to `None` or an
//! empty collection. A key that is present with a JSON type the worker never
//! writes is a named [`WorkerOutputError`] instead, never a silent default.
//!
//! This is a pure translation: no database, no service loop, no Python.

use std::fmt;

use serde_json::{Map, Value};

use cms_db::FileDigest;
use cms_proto::{DigestMap, JobKey};

/// What one sandbox run measured, in the figures a result writer stores.
///
/// The `plus` object also reports `exit_status` and an optional `signal`; those
/// are the box's verdict rather than a stored figure, so this type carries only
/// the five columns a result row keeps. A `plus` of `{}` yields one of these
/// with every field `None`, which is the worker's "the box worked but measured
/// nothing" and is distinct from `plus` being null.
#[derive(Debug, Clone, PartialEq)]
pub struct RunStats {
    /// `execution_time`, CPU seconds, `None` when the box measured none.
    pub execution_time: Option<f64>,
    /// `execution_wall_clock_time`, seconds, `None` when the box measured none.
    pub wall_clock_time: Option<f64>,
    /// `execution_memory`, bytes, `None` when the box measured none.
    pub memory_bytes: Option<i64>,
    /// Captured standard output, `None` when none was captured.
    pub stdout: Option<String>,
    /// Captured standard error, `None` when none was captured.
    pub stderr: Option<String>,
}

/// The result fields a returned worker job body carries, read strictly.
///
/// A body is the result of either a compilation or an evaluation. The keys only
/// one of them writes stay `None` or empty here, so a writer reads one shape
/// whichever job came back. Digest maps are [`DigestMap`]s, so their filename
/// order is deterministic, and `sandboxes` keeps the order the worker wrote.
#[derive(Debug, Clone, PartialEq)]
pub struct WorkerOutput {
    /// Whether the worker box itself worked; the one required field.
    pub success: bool,
    /// A compilation's own verdict, `None` for an evaluation body.
    pub compilation_success: Option<bool>,
    /// An evaluation's outcome string, `None` for a compilation body.
    pub outcome: Option<String>,
    /// The contestant-facing report lines in order, `None` when null or absent.
    pub text: Option<Vec<String>>,
    /// The administrator-facing report, `None` when null or absent.
    pub admin_text: Option<String>,
    /// The digest of the user program's output file, parsed by value.
    pub user_output: Option<FileDigest>,
    /// The sandbox paths the report names, empty when null or absent.
    pub sandboxes: Vec<String>,
    /// Archived sandbox digests keyed by path.
    pub sandbox_digests: DigestMap,
    /// Produced executables keyed by filename.
    pub executables: DigestMap,
    /// The run's measurements, `None` when `plus` is null or absent.
    pub stats: Option<RunStats>,
    /// The worker index that ran the job, `None` when the body carries none.
    /// The worker stamps it on every job it runs, and the result row stores it
    /// as the shard that compiled or evaluated the submission.
    pub shard: Option<i32>,
    /// The tombstone flag in `plus`, false when absent or null.
    pub tombstone: bool,
}

/// Why a returned worker body could not be read into a [`WorkerOutput`].
///
/// Every variant names the key that refused the body, so a log line points at
/// the field to look at rather than at a generic decode failure.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkerOutputError {
    /// A required key was absent from the body.
    MissingKey {
        /// The name of the missing key.
        key: &'static str,
    },
    /// A key was present with a JSON type the worker never writes.
    WrongType {
        /// The name of the key that held the wrong type.
        key: &'static str,
        /// The type the reader expected at that key.
        expected: &'static str,
    },
    /// A string that must be a `FileDigest` was refused by value.
    BadDigest {
        /// The name of the key that held the string.
        key: &'static str,
        /// The digest parser's own account of the refusal.
        detail: String,
    },
}

impl fmt::Display for WorkerOutputError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MissingKey { key } => write!(f, "required key `{key}` is absent"),
            Self::WrongType { key, expected } => write!(f, "key `{key}` must be {expected}"),
            Self::BadDigest { key, detail } => {
                write!(f, "key `{key}` is not a valid digest: {detail}")
            }
        }
    }
}

impl std::error::Error for WorkerOutputError {}

/// The non-null value at `key`, or `None` when the key is absent or null.
fn present<'a>(body: &'a Map<String, Value>, key: &str) -> Option<&'a Value> {
    match body.get(key) {
        Some(Value::Null) | None => None,
        Some(value) => Some(value),
    }
}

fn wrong(key: &'static str, expected: &'static str) -> WorkerOutputError {
    WorkerOutputError::WrongType { key, expected }
}

/// The one required field: a boolean `success`, refused when absent or mistyped.
fn read_success(body: &Map<String, Value>) -> Result<bool, WorkerOutputError> {
    let key = JobKey::SUCCESS.as_str();
    match body.get(key) {
        Some(Value::Bool(b)) => Ok(*b),
        Some(_) => Err(wrong(key, "a JSON boolean")),
        None => Err(WorkerOutputError::MissingKey { key }),
    }
}

fn opt_bool(
    body: &Map<String, Value>,
    key: &'static str,
) -> Result<Option<bool>, WorkerOutputError> {
    match present(body, key) {
        None => Ok(None),
        Some(Value::Bool(b)) => Ok(Some(*b)),
        Some(_) => Err(wrong(key, "a JSON boolean")),
    }
}

fn opt_string(
    body: &Map<String, Value>,
    key: &'static str,
) -> Result<Option<String>, WorkerOutputError> {
    match present(body, key) {
        None => Ok(None),
        Some(Value::String(s)) => Ok(Some(s.clone())),
        Some(_) => Err(wrong(key, "a JSON string")),
    }
}

fn opt_f64(body: &Map<String, Value>, key: &'static str) -> Result<Option<f64>, WorkerOutputError> {
    match present(body, key) {
        None => Ok(None),
        Some(Value::Number(n)) => n
            .as_f64()
            .map(Some)
            .ok_or_else(|| wrong(key, "a JSON number")),
        Some(_) => Err(wrong(key, "a JSON number")),
    }
}

fn opt_i64(body: &Map<String, Value>, key: &'static str) -> Result<Option<i64>, WorkerOutputError> {
    match present(body, key) {
        None => Ok(None),
        Some(Value::Number(n)) => n
            .as_i64()
            .map(Some)
            .ok_or_else(|| wrong(key, "a JSON integer")),
        Some(_) => Err(wrong(key, "a JSON integer")),
    }
}

fn read_string_array(value: &Value, key: &'static str) -> Result<Vec<String>, WorkerOutputError> {
    let Value::Array(items) = value else {
        return Err(wrong(key, "an array of strings"));
    };
    let mut out = Vec::with_capacity(items.len());
    for item in items {
        let Value::String(text) = item else {
            return Err(wrong(key, "an array of strings"));
        };
        out.push(text.clone());
    }
    Ok(out)
}

fn opt_text(
    body: &Map<String, Value>,
    key: &'static str,
) -> Result<Option<Vec<String>>, WorkerOutputError> {
    match present(body, key) {
        None => Ok(None),
        Some(value) => Ok(Some(read_string_array(value, key)?)),
    }
}

fn string_vec(
    body: &Map<String, Value>,
    key: &'static str,
) -> Result<Vec<String>, WorkerOutputError> {
    match present(body, key) {
        None => Ok(Vec::new()),
        Some(value) => read_string_array(value, key),
    }
}

fn digest_map(
    body: &Map<String, Value>,
    key: &'static str,
) -> Result<DigestMap, WorkerOutputError> {
    let Some(value) = present(body, key) else {
        return Ok(DigestMap::new());
    };
    let Value::Object(entries) = value else {
        return Err(wrong(key, "a JSON object"));
    };
    let mut out = DigestMap::new();
    for (filename, digest) in entries {
        let Value::String(text) = digest else {
            return Err(wrong(key, "string digest values"));
        };
        out.insert(filename.clone(), text.clone());
    }
    Ok(out)
}

fn opt_filedigest(
    body: &Map<String, Value>,
    key: &'static str,
) -> Result<Option<FileDigest>, WorkerOutputError> {
    let Some(value) = present(body, key) else {
        return Ok(None);
    };
    let Value::String(text) = value else {
        return Err(wrong(key, "a JSON string"));
    };
    match text.parse::<FileDigest>() {
        Ok(digest) => Ok(Some(digest)),
        Err(source) => Err(WorkerOutputError::BadDigest {
            key,
            detail: source.to_string(),
        }),
    }
}

/// `plus` is null/absent (`None`), an empty or measured object (`Some`), or a
/// non-object refusal. Its sub-keys are the measured-field names the worker's
/// `stats_value` writes; unlike the body's keys they are not `JobKey` names.
fn read_stats(body: &Map<String, Value>) -> Result<Option<RunStats>, WorkerOutputError> {
    let key = JobKey::PLUS.as_str();
    match present(body, key) {
        None => Ok(None),
        Some(Value::Object(plus)) => Ok(Some(RunStats {
            execution_time: opt_f64(plus, "execution_time")?,
            wall_clock_time: opt_f64(plus, "execution_wall_clock_time")?,
            memory_bytes: opt_i64(plus, "execution_memory")?,
            stdout: opt_string(plus, "stdout")?,
            stderr: opt_string(plus, "stderr")?,
        })),
        Some(_) => Err(wrong(key, "a JSON object or null")),
    }
}

/// `plus.tombstone` is a boolean flag, false when `plus` holds none.
fn read_tombstone(body: &Map<String, Value>) -> Result<bool, WorkerOutputError> {
    let Some(Value::Object(plus)) = present(body, JobKey::PLUS.as_str()) else {
        return Ok(false);
    };
    match plus.get("tombstone") {
        None | Some(Value::Null) => Ok(false),
        Some(Value::Bool(flag)) => Ok(*flag),
        Some(_) => Err(wrong("tombstone", "a JSON boolean")),
    }
}

/// The `shard` key the worker stamps on every job it runs, as the store's
/// `Integer`; a value outside that range is a named refusal rather than a
/// silently dropped column.
fn read_shard(body: &Map<String, Value>) -> Result<Option<i32>, WorkerOutputError> {
    let Some(shard) = opt_i64(body, JobKey::SHARD.as_str())? else {
        return Ok(None);
    };
    i32::try_from(shard)
        .map(Some)
        .map_err(|_| wrong(JobKey::SHARD.as_str(), "a 32-bit integer"))
}

/// Reads a returned worker job body into the fields a result writer stores.
///
/// `success` is required. Every other result key defaults to `None` or an empty
/// collection when absent or null, exactly as the worker omits or nulls it. A
/// present key of the wrong JSON type, a `plus` that is not an object and a
/// `user_output` that is not a valid digest are named refusals; build-time keys
/// are left untouched.
///
/// # Errors
///
/// Returns [`WorkerOutputError`] for a missing `success`, any result key with an
/// unexpected JSON type, a non-object `plus`, or an invalid `user_output` digest.
pub fn worker_output(body: &Map<String, Value>) -> Result<WorkerOutput, WorkerOutputError> {
    Ok(WorkerOutput {
        success: read_success(body)?,
        compilation_success: opt_bool(body, JobKey::COMPILATION_SUCCESS.as_str())?,
        outcome: opt_string(body, JobKey::OUTCOME.as_str())?,
        text: opt_text(body, JobKey::TEXT.as_str())?,
        admin_text: opt_string(body, JobKey::ADMIN_TEXT.as_str())?,
        user_output: opt_filedigest(body, JobKey::USER_OUTPUT.as_str())?,
        sandboxes: string_vec(body, JobKey::SANDBOXES.as_str())?,
        sandbox_digests: digest_map(body, JobKey::SANDBOX_DIGESTS.as_str())?,
        executables: digest_map(body, JobKey::EXECUTABLES.as_str())?,
        stats: read_stats(body)?,
        shard: read_shard(body)?,
        tombstone: read_tombstone(body)?,
    })
}
