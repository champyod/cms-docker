//! Taking one field out of an object, once its keys have been checked.
//!
//! Every reader here names the key it wants, which is why
//! [`JobKey`](super::JobKey) exists: a name is only ever written down once.

use serde::de::DeserializeOwned;
use serde_json::{Map, Value};

use crate::jobs::refusal::JobError;

/// Refuses a JSON object whose keys are not exactly `key_set`.
///
/// Runs before any value is read, so a job carrying a key the Python side would
/// not have produced is named by that key rather than by whatever value happens
/// to sit under a field the Rust side expected.
///
/// # Errors
///
/// Returns [`JobError::UnknownKey`] for the first key the set does not list, and
/// [`JobError::MissingKey`] for the first key the set lists and the object
/// omits. Both name the key, so a log line says which one to look at.
pub fn check_key_set(
    object: &Map<String, Value>,
    key_set: &[&'static str],
) -> Result<(), JobError> {
    for name in object.keys() {
        if !key_set.contains(&name.as_str()) {
            return Err(JobError::UnknownKey { key: name.clone() });
        }
    }
    for key in key_set {
        if !object.contains_key(*key) {
            return Err(JobError::MissingKey { key });
        }
    }
    Ok(())
}

/// Reads one key of a known type out of an object.
///
/// # Errors
///
/// Returns [`JobError::MissingKey`] when the object has no such key, and
/// [`JobError::WrongValue`] naming the key when the value under it is not of
/// the type the job declares.
pub fn field<T: DeserializeOwned>(
    object: &Map<String, Value>,
    key: &'static str,
) -> Result<T, JobError> {
    let value = object.get(key).ok_or(JobError::MissingKey { key })?;
    T::deserialize(value).map_err(|source| JobError::WrongValue {
        key,
        detail: source.to_string(),
    })
}

/// Reads a discriminator key, whose value names a variant.
///
/// # Errors
///
/// Returns [`JobError::MissingKey`] when the object has no such key, and
/// [`JobError::WrongValue`] naming the key when its value is not a string.
pub fn read_name(object: &Map<String, Value>, key: &'static str) -> Result<String, JobError> {
    match object.get(key) {
        Some(Value::String(name)) => Ok(name.clone()),
        Some(_) => Err(JobError::WrongValue {
            key,
            detail: "expected a JSON string".to_owned(),
        }),
        None => Err(JobError::MissingKey { key }),
    }
}
