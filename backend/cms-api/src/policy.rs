//! The decision: the admin row's enabled flag and the resolved set in, one verdict out.

use cms_db::{EffectivePermissions, PermissionError};

use crate::allowlist::{allows, tier_for};

/// What the row read said about the admin, beside the keys the read resolved.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Access {
    /// `admins.enabled`; a disabled account holds nothing and may call nothing.
    pub enabled: bool,
    /// The keys the permission rows resolved to.
    pub effective: EffectivePermissions,
}

/// Why the rows the decision needs could not be read.
#[derive(Debug)]
pub enum AccessError {
    /// The `admins` row read itself failed.
    Row(sqlx::Error),
    /// Resolving the admin's keys failed.
    Permissions(PermissionError),
}

impl std::fmt::Display for AccessError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Row(error) => write!(formatter, "reading the admin row failed: {error}"),
            Self::Permissions(error) => {
                write!(formatter, "resolving the admin's keys failed: {error}")
            }
        }
    }
}

impl std::error::Error for AccessError {}

/// Whether this admin row and resolved set may call the RPC.
///
/// WHY enabled is checked here: the resolved set of a disabled admin is empty, and the empty set would otherwise land in the tier that admits `get_resources`.
#[must_use]
pub fn permits(access: &Access, service: &str, method: &str) -> bool {
    access.enabled && allows(tier_for(&access.effective), service, method)
}

/// Whether the read's answer admits the RPC; a missing row and a failed read both refuse.
///
/// WHY `Ok(None)` refuses rather than falling through to the floor tier: the floor admits `get_resources`, so an admin that does not exist must not reach it.
#[must_use]
pub fn verdict(loaded: Result<Option<Access>, AccessError>, service: &str, method: &str) -> bool {
    match loaded {
        Ok(Some(access)) => permits(&access, service, method),
        Ok(None) | Err(_) => false,
    }
}
