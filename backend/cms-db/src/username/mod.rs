//! Contestant display usernames: the policy rule, and the tables behind it.
//!
//! `resolve_username_config` (`src/cms/db/username/resolution.py:72-91`) answers
//! one question per user: may they configure a display username in this
//! contest? The precedence is fixed, and it is a security rule rather than a
//! preference:
//!
//! 1. a row at `contest` scope decides for every participant, and nothing at a
//!    narrower scope can reopen it;
//! 2. otherwise a row at `user` scope decides for that user;
//! 3. otherwise the group verdicts apply, and a `deny` on any of the user's
//!    groups beats an `allow` on another;
//! 4. with no row anywhere the feature is denied.
//!
//! `models.rs` holds the five table declarations. The uniqueness rule —
//! `(contest_id, username)` on `contest_usernames`, and a username freed before
//! the history row is appended (`resolution.py:185-211`) — is a constraint and a
//! write ordering rather than a column, so it is not part of a declaration; it
//! belongs to the write that sets the alias.

mod models;
mod policy;

pub use models::{
    CONTESTANT_GROUP, CONTESTANT_GROUP_MEMBERSHIP, CONTEST_USERNAME, CONTEST_USERNAME_HISTORY,
    USERNAME_POLICY,
};
pub use policy::{resolve_config, ConfigInputs, Policy};
