//! Column-level type mapping for the contest database.
//!
//! The four mappings in [`types`] turn the shapes the rest of CMS already
//! exchanges into Rust values the driver can bind and decode, so that a row the
//! database would have refused never reaches a query:
//!
//! | Rust type | Postgres column | Reference it reproduces |
//! |---|---|---|
//! | [`Interval`] | `interval` | `cms.db.types` mapping `Interval` to `timedelta` |
//! | [`FileDigest`] | `varchar` under the `DIGEST` domain | `cms.db.types.Digest` |
//! | [`CacheHandle`] | `varchar` under the `DIGEST` domain | `cms.db.filecacher.FileCacher` |
//! | [`PasswordForm`] | `varchar` on `admins.authentication` | `cmscommon.crypto.parse_authentication` |
//! | [`PermissionInputs`] | `groups` / `admin_permission_overrides` | `get_effective_permissions` |
//!
//! Each mapping carries the reference's own acceptance rule rather than a
//! looser one, so a value the database would have refused is refused here too
//! instead of reaching a query. Nothing here opens a connection: the mappings
//! are the values a query binds and the rows it decodes, and their tests run
//! against captured column shapes with no server.
//!
//! # Errors
//!
//! Every fallible mapping returns the error type named beside it, and each
//! variant says which reference rule it enforces. No mapping degrades to a
//! default on bad input.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

mod auth;
mod digest;
mod interval;
mod permission;
mod types;

pub use types::{
    resolve, AuthError, BcryptPassword, BcryptVerifier, CacheError, CacheHandle, DigestError,
    Effect, EffectivePermissions, FileDigest, Interval, IntervalError, PasswordForm,
    PermissionInputs, PlaintextPassword, RemoveAction, DIGEST_HEX_LEN, MICROS_PER_DAY,
    MICROS_PER_HOUR, MICROS_PER_MINUTE, MICROS_PER_SECOND, TOMBSTONE, WILDCARD_PERMISSION,
};
