//! The crate's type surface: one module per column family, re-exported here so
//! a caller has a single place to read what each column maps to.
//!
//! Each mapping is a newtype rather than a bare alias, so a value that reached a
//! query has already passed the rule its column enforces and a caller cannot
//! build one that has not. The driver's own `Text` wrapper is what makes a
//! newtype in a text column usable as a bind and row type, so none is declared
//! by hand here.

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
