//! Contestant display usernames: the policy rule, the aliases, and their history.
//!
//! `resolve_username_config` (`src/cms/db/username/resolution.py:72-91`) answers one
//! question per user: may they configure a display username here? The precedence is
//! fixed, and it is a security rule rather than a preference:
//!
//! 1. a row at `contest` scope decides for every participant, and nothing narrower can reopen it;
//! 2. otherwise a row at `user` scope decides for that user;
//! 3. otherwise the group verdicts apply, and a `deny` on any group beats an `allow` on another;
//! 4. with no row anywhere the feature is denied.
//!
//! [`resolve_config`] is that rule as a pure function, `resolution` the queries that
//! fill it and the name a row shows as, `mutation` the write that sets or clears one,
//! and `models.rs` the five table declarations and the alias row.
//!
//! # Errors
//!
//! [`UsernameError`] names what the reference refused: a name another user of the same
//! contest holds, a stored alias the domain would not admit, and the driver's own
//! refusals. No function degrades to a default on any of them.

mod models;
mod mutation;
mod policy;
mod resolution;

pub use models::{
    DisplayUsername, CONTESTANT_GROUP, CONTESTANT_GROUP_MEMBERSHIP, CONTEST_USERNAME,
    CONTEST_USERNAME_HISTORY, USERNAME_POLICY,
};
pub use mutation::set_display_username;
pub use policy::{resolve_config, ConfigInputs, Policy};
pub use resolution::{
    get_display_name, get_display_username, get_display_usernames, load_config_inputs,
    username_config_allowed,
};

use crate::codename::CodenameError;

/// Why a display-username read or write was refused.
#[derive(Debug, thiserror::Error)]
pub enum UsernameError {
    /// Another user of the same contest already holds the name.
    #[error("Display username already taken in this contest")]
    Taken,
    /// A stored alias is not a codename, which only a plain `varchar` column can hold.
    #[error(transparent)]
    Codename(#[from] CodenameError),
    /// The driver refused the statement.
    #[error(transparent)]
    Database(#[from] sqlx::Error),
}
