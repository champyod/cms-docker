//! The `admins` row and the checks the panel makes against it.
//!
//! `src/cms/db/admin.py:29-60` holds the row: a `CODENAME` username, the
//! `<method>:<payload>` credential the login checks, and the enabled flag that
//! makes a disabled account behave as if it did not exist. Its permission set is
//! not a column — the request handler resolves it and assigns it to the instance
//! (`src/cms/server/admin/handlers/base.py:462`) — so [`Admin::has_permission`]
//! takes the resolved set as its argument instead of reading an attribute the
//! struct does not have.
//!
//! # The wildcard
//!
//! `admin.py:69` grants any key whenever `all:all` is in the set, even beside a
//! concrete key. This port uses the stricter rule the authorisation boundary
//! itself applies (`handlers/base.py:198-206`): the wildcard stands for every
//! key only while it is the whole set, because `get_effective_permissions`
//! expands it and then subtracts the denies while leaving `all:all` behind.
//! Under the reference's admin-level check that leftover would re-grant a key a
//! per-person deny had just removed; the boundary check refuses it, and an
//! explicit denial must not be widened by the wildcard it was meant to override.

use crate::auth::{BcryptVerifier, PasswordForm};
use crate::base::{Column, ColumnKind, Declaration};
use crate::codename::Codename;
use crate::permission::EffectivePermissions;

/// The `admins` table (`src/cms/db/admin.py:38-60`).
pub const ADMIN: Declaration = Declaration {
    table: "admins",
    columns: &[
        Column::key("id", ColumnKind::Integer),
        Column::required("name", ColumnKind::Text),
        Column::required("username", ColumnKind::Text),
        Column::required("authentication", ColumnKind::Text),
        Column::generated("enabled", ColumnKind::Boolean),
    ],
    relationships: &["admin_groups"],
};

/// A row of `admins`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Admin {
    /// `admins.id`.
    pub id: i32,
    /// `admins.name`, the human-readable name.
    pub name: String,
    /// `admins.username`, which the `CODENAME` domain admits.
    pub username: Codename,
    /// `admins.authentication`, as the column stores it.
    pub authentication: PasswordForm,
    /// `admins.enabled`; a disabled account holds no permission and cannot log in.
    pub enabled: bool,
}

impl Admin {
    /// Whether the resolved set holds any of `keys`.
    ///
    /// A wildcard that is the whole set grants every key, which keeps a caller
    /// that never expanded it from refusing a permission the admin plainly has.
    #[must_use]
    pub fn has_permission(&self, effective: &EffectivePermissions, keys: &[&str]) -> bool {
        keys.iter().any(|key| effective.grants(key))
    }

    /// Whether `candidate` is this admin's password and the account is enabled.
    ///
    /// The login path checks both, and refuses when either fails
    /// (`src/cms/server/admin/handlers/main.py:106-115`). A plaintext row never
    /// verifies, so a legacy credential fails closed instead of comparing in the
    /// clear.
    #[must_use]
    pub fn authenticates(&self, candidate: &str, verifier: &impl BcryptVerifier) -> bool {
        self.enabled && self.authentication.verify(candidate, verifier)
    }
}
