//! The identity a database transaction acts as.
//!
//! Row-level security is keyed on one transaction-local GUC, [`ACTOR_SETTING`];
//! with nothing set every predicate is false, so a transaction that does not say
//! who it is reads no row and writes none. Three rules follow:
//!
//! 1. one implementation — the stamp is applied wherever a transaction begins, so
//!    a transaction that begins after a commit is stamped again;
//! 2. transaction scope on anything pooled — a pooled connection that kept a
//!    previous transaction's actor would leak one request's identity into the next;
//! 3. no silent fallback — a malformed identity is refused rather than degrading
//!    to a valid one, because a typo in a deployment variable must not quietly
//!    become the core and grant a script the core's access.
//!
//! The core is one process family with one database role, so it announces itself
//! as [`CORE_ACTOR`]. [`process_label`] carries the program's name alongside it for
//! logs and the audit trail, and is deliberately not part of the authorization key:
//! authorization must not depend on which console script is running.

use std::path::Path;

/// The GUC the policies read.
///
/// Changing it is a schema-level decision: the policy generator renders the same
/// name into every predicate, so this constant and that script must move together.
pub const ACTOR_SETTING: &str = "cms.actor";

/// The identity every core program acts as; the process label below is not.
pub const CORE_ACTOR: &str = "system:core";

/// The variable that overrides the identity.
///
/// WHY the environment and not a flag: every core entry point is a separate
/// binary, so a flag would have to be threaded through all of them, while the
/// environment is what the container already carries.
pub const ACTOR_ENV: &str = "CMS_DB_ACTOR";

/// The full set the policy generator knows about.
///
/// Restated here only so a mistaken value fails at start-up with a readable
/// message instead of at the first query with an empty result set.
pub const KNOWN_SYSTEM_ACTORS: [&str; 5] = [
    "system:auth",
    "system:cli",
    "system:core",
    "system:ingest",
    "system:migration",
];

/// The statement that stamps the current transaction, binding the actor as `$1`.
///
/// WHY `true`: it is `is_local`, so COMMIT and ROLLBACK undo the setting and a
/// pooled connection cannot carry it into the next transaction.
pub const TRANSACTION_STAMP_SQL: &str = "SELECT set_config('cms.actor', $1, true)";

/// The statement that stamps a never-pooled connection for its whole lifetime.
///
/// WHY `false` only here: this is the one path whose traffic commits mid-stream
/// (large objects), where a transaction scope would leave the rest unidentified.
pub const CONNECTION_STAMP_SQL: &str = "SELECT set_config('cms.actor', $1, false)";

/// The identity the policies could not read, and why.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ActorError {
    /// Not one of the two shapes a policy accepts.
    #[error("not a usable database actor: {0:?} (expected 'admin:<id>' or 'system:<name>')")]
    Malformed(String),
    /// A system identity outside the allowlist, which would match no policy.
    #[error(
        "unknown system identity {actor:?}: the policies name their identities explicitly, \
         so this one would match no policy; known: {known}"
    )]
    UnknownSystem {
        /// The refused identity.
        actor: String,
        /// The identities the policies do name.
        known: String,
    },
    /// The configured value is not text, so it cannot name an actor.
    #[error("CMS_DB_ACTOR is not valid UTF-8, so it cannot name a database actor")]
    NotText,
}

/// Return `actor` if the policies can read it, else [`ActorError`].
///
/// A system identity outside [`KNOWN_SYSTEM_ACTORS`] is refused too: the
/// predicates name their identities explicitly, so an unknown one would
/// authenticate as nobody and the only symptom would be an empty table, a failure
/// that reads like "the database is empty" rather than "you are nobody".
pub fn validate_actor(actor: &str) -> Result<&str, ActorError> {
    if !is_policy_readable(actor) {
        return Err(ActorError::Malformed(actor.to_owned()));
    }
    if actor.starts_with("system:") && !KNOWN_SYSTEM_ACTORS.contains(&actor) {
        return Err(ActorError::UnknownSystem {
            actor: actor.to_owned(),
            known: KNOWN_SYSTEM_ACTORS.join(", "),
        });
    }
    Ok(actor)
}

/// The identity this process acts as.
///
/// `CMS_DB_ACTOR` wins when set, so an operator can attribute a one-off job to a
/// named identity without a code change; otherwise the core identity. A value
/// that is blank after trimming is not configured; a value that is set but
/// malformed is an error, never a fallback.
pub fn default_actor() -> Result<String, ActorError> {
    let Some(configured) = std::env::var_os(ACTOR_ENV) else {
        return Ok(CORE_ACTOR.to_owned());
    };
    let configured = configured.into_string().map_err(|_| ActorError::NotText)?;
    let configured = configured.trim();
    if configured.is_empty() {
        return Ok(CORE_ACTOR.to_owned());
    }
    validate_actor(configured).map(str::to_owned)
}

/// A human-readable name for this program, for logs and the audit trail.
pub fn process_label() -> String {
    let argv0 = std::env::args_os().next().unwrap_or_default();
    label_for(&argv0.to_string_lossy())
}

/// The file name of `argv0`, or `cms` when there is none.
///
/// WHY this is not the actor: the programs share one role, so a per-program allowlist entry would multiply the policy surface without adding a boundary.
pub fn label_for(argv0: &str) -> String {
    Path::new(argv0)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "cms".to_owned())
}

/// The reference regex as character tests: exactly what `cms_actor_admin_id()` accepts plus the system namespace.
///
/// A name with a colon in the wrong place, an admin id with a sign, surrounding whitespace: refused here, not passed to a policy that would treat it as nobody.
fn is_policy_readable(actor: &str) -> bool {
    if let Some(id) = actor.strip_prefix("admin:") {
        return (1..=9).contains(&id.len()) && id.bytes().all(|byte| byte.is_ascii_digit());
    }
    actor.strip_prefix("system:").is_some_and(is_system_name)
}

/// `[a-z][a-z0-9:_-]{0,63}`, counted in bytes because every accepted byte is ASCII.
fn is_system_name(name: &str) -> bool {
    let mut bytes = name.bytes();
    let starts_lowercase = bytes.next().is_some_and(|byte| byte.is_ascii_lowercase());
    starts_lowercase
        && name.len() <= 64
        && bytes.all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b':' | b'_' | b'-')
        })
}
