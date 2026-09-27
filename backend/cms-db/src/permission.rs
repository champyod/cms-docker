//! Effective permission keys for one admin.
//!
//! `get_effective_permissions` resolves an admin's keys in a fixed order: the
//! keys their groups grant, united with the keys their per-person overrides
//! allow, then the wildcard expanded into every registered key, and finally the
//! per-person denies subtracted. The wildcard is expanded *before* the denies so
//! that denying it on one person takes everything away, and the resolution fails
//! closed — a disabled or missing admin resolves to no keys at all.
//!
//! Every input is a set of keys, so the resolution is a pure function of what
//! the rows said and can be exercised without a database.

use std::collections::BTreeSet;

/// The key that grants every capability, matched by name everywhere it appears.
pub const WILDCARD_PERMISSION: &str = "all:all";

/// What one row of `admin_permission_overrides` asks for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Effect {
    /// The row grants the key to this person.
    Allow,
    /// The row takes the key away from this person.
    Deny,
}

impl Effect {
    /// The effect a stored `effect` column names, if it names one.
    ///
    /// A value that is neither `allow` nor `deny` contributes nothing, which is
    /// what the two `filter(AdminPermissionOverride.effect == ...)` clauses do
    /// with a row they match no.
    #[must_use]
    pub fn of(effect: &str) -> Option<Self> {
        match effect {
            "allow" => Some(Self::Allow),
            "deny" => Some(Self::Deny),
            _ => None,
        }
    }
}

/// The rows one admin's permissions resolve from.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PermissionInputs {
    /// Whether the admin row is enabled. A missing row is passed as disabled.
    pub is_enabled: bool,
    /// Keys reached through `admin_groups` and `group_permissions`.
    pub group_grants: BTreeSet<String>,
    /// Keys the per-person `allow` overrides name.
    pub allow_overrides: BTreeSet<String>,
    /// Keys the per-person `deny` overrides name.
    pub deny_overrides: BTreeSet<String>,
    /// Every key the `permissions` table holds, which the wildcard expands into.
    pub registered_keys: BTreeSet<String>,
}

/// The keys an admin holds once group grants, overrides and denies are applied.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct EffectivePermissions {
    keys: BTreeSet<String>,
}

impl EffectivePermissions {
    /// No keys at all, which is what a disabled or missing admin resolves to.
    #[must_use]
    pub fn none() -> Self {
        Self::default()
    }

    /// The keys held, in a fixed order.
    #[must_use]
    pub const fn keys(&self) -> &BTreeSet<String> {
        &self.keys
    }

    /// Whether no key is held.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.keys.is_empty()
    }

    /// Whether a key is held.
    ///
    /// A set that is the wildcard on its own grants everything, which is what
    /// keeps a caller that never expanded it from refusing a permission the
    /// admin plainly has. Once the wildcard has been expanded it sits beside
    /// every other key, so an unregistered key is then correctly refused.
    #[must_use]
    pub fn grants(&self, key: &str) -> bool {
        if self.keys.contains(key) {
            return true;
        }
        self.keys.contains(WILDCARD_PERMISSION) && self.keys.len() == 1
    }
}

/// Resolves the keys one admin holds.
///
/// # Errors
///
/// This function cannot fail. An admin that is missing or disabled resolves to
/// [`EffectivePermissions::none`], which is the fail-closed answer the Python
/// side returns for a row it cannot read as well as for one that grants nothing.
#[must_use]
pub fn resolve(inputs: &PermissionInputs) -> EffectivePermissions {
    if !inputs.is_enabled {
        return EffectivePermissions::none();
    }
    let mut keys = inputs.group_grants.clone();
    keys.extend(inputs.allow_overrides.iter().cloned());
    expand_wildcard(&mut keys, inputs);
    for denied in &inputs.deny_overrides {
        keys.remove(denied);
    }
    EffectivePermissions { keys }
}

/// Replaces the wildcard with the registered keys, or drops it.
///
/// A wildcard that is itself denied is dropped instead of expanded, so denying
/// one person `all:all` leaves them with whatever else their groups granted
/// rather than with the whole table.
fn expand_wildcard(keys: &mut BTreeSet<String>, inputs: &PermissionInputs) {
    let is_denied = inputs.deny_overrides.contains(WILDCARD_PERMISSION);
    if keys.contains(WILDCARD_PERMISSION) && !is_denied {
        keys.extend(inputs.registered_keys.iter().cloned());
        return;
    }
    keys.remove(WILDCARD_PERMISSION);
}
