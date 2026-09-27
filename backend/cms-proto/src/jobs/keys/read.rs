//! Taking one field out of an object, once its keys have been checked.
//!
//! [`check_key_set`] compares an object against the names a key set writes, and
//! the two readers below name the key they want with a
//! [`JobKey`](super::JobKey). That is what keeps a name written down once: a
//! plain literal beside a reader would compile against a job shape that never
//! writes it, and would be a second copy of a name the constant already holds.

use serde::de::DeserializeOwned;
use serde_json::{Map, Value};

use super::name::JobKey;
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
pub fn field<T: DeserializeOwned>(object: &Map<String, Value>, key: JobKey) -> Result<T, JobError> {
    let name = key.as_str();
    let value = object.get(name).ok_or(JobError::MissingKey { key: name })?;
    T::deserialize(value).map_err(|source| JobError::WrongValue {
        key: name,
        detail: source.to_string(),
    })
}

/// Reads a discriminator key, whose value names a variant.
///
/// # Errors
///
/// Returns [`JobError::MissingKey`] when the object has no such key, and
/// [`JobError::WrongValue`] naming the key when its value is not a string.
pub fn read_name(object: &Map<String, Value>, key: JobKey) -> Result<String, JobError> {
    let name = key.as_str();
    match object.get(name) {
        Some(Value::String(found)) => Ok(found.clone()),
        Some(_) => Err(JobError::WrongValue {
            key: name,
            detail: "expected a JSON string".to_owned(),
        }),
        None => Err(JobError::MissingKey { key: name }),
    }
}
