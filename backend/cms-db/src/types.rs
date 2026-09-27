//! The crate's type surface: one module per column family, re-exported here so
//! a caller has a single place to read what each column maps to.
//!
//! Each mapping is a newtype rather than a bare alias, so a value that reached a
//! query has already passed the rule its column enforces and a caller cannot
//! build one that has not.
//!
//! Only [`Interval`] is a bind and a row type today, because an `interval` is
//! the one column here that is not text: `interval::wire` declares the driver's
//! `Type`, `Encode` and `Decode` for it by hand. [`FileDigest`], [`CacheHandle`],
//! [`PasswordForm`] and [`PermissionInputs`] apply their column's rule and hand
//! the caller the value as a string, so they are validation only — the query step
//! that reads and writes those columns is what binds and decodes them, and until
//! it exists no driver trait is declared for any of them.
//!
//! # Errors
//!
//! Every fallible mapping reports the error type re-exported beside it here:
//! [`IntervalError`], [`DigestError`], [`CacheError`] and [`AuthError`]. A
//! [`PermissionInputs`] set is read from rows rather than parsed, so resolving it
//! cannot fail.

pub use crate::auth::{AuthError, BcryptPassword, BcryptVerifier, PasswordForm, PlaintextPassword};
pub use crate::digest::{
    CacheError, CacheHandle, DigestError, FileDigest, RemoveAction, DIGEST_HEX_LEN, TOMBSTONE,
};
pub use crate::interval::{
    Interval, IntervalError, MICROS_PER_DAY, MICROS_PER_HOUR, MICROS_PER_MINUTE, MICROS_PER_SECOND,
};
pub use crate::permission::{
    resolve, Effect, EffectivePermissions, PermissionInputs, WILDCARD_PERMISSION,
};
