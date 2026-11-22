//! The contest/user/group precedence behind `resolve_username_config`.
//!
//! `src/cms/db/username/resolution.py:62-91` resolves one contest's policy rows
//! into a yes or no per participant. The rows are already grouped by scope here,
//! so the rule is a pure function of what they said and needs no database.
//!
//! WHY the contest row short-circuits: the reference returns
//! `{user_id: contest_policy == "allow"}` as soon as a contest row exists
//! (`resolution.py:83-85`), before it reads any user or group row. A narrower
//! `deny` cannot reopen what the contest owner set, and a narrower `allow`
//! cannot override it either.

use std::collections::{BTreeMap, BTreeSet};

/// One `username_policies.policy` value.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Policy {
    /// The scope permits the feature.
    Allow,
    /// The scope forbids it.
    Deny,
}

impl Policy {
    /// The policy a stored `allow`/`deny` names, if it names one.
    ///
    /// The column is an enum of exactly these two values, so anything else is a
    /// value the database would have refused; it contributes no row.
    #[must_use]
    pub fn of(value: &str) -> Option<Self> {
        match value {
            "allow" => Some(Self::Allow),
            "deny" => Some(Self::Deny),
            _ => None,
        }
    }

    /// Whether this policy permits the feature.
    #[must_use]
    pub const fn is_allow(self) -> bool {
        matches!(self, Self::Allow)
    }
}

/// The rows one contest's policy lookup returned, grouped by scope.
///
/// `group_denied` and `group_allowed` are the verdicts over the user's group
/// memberships, not the rows themselves: a user with a `deny` row is in the
/// first set, one with only `allow` rows is in the second, and a user in both is
/// denied because the deny is checked first.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ConfigInputs {
    /// The row at `contest` scope, absent when the contest has none.
    pub contest: Option<Policy>,
    /// Rows at `user` scope, keyed by the user they name.
    pub users: BTreeMap<i32, Policy>,
    /// Users with a `deny` row on any of their groups.
    pub group_denied: BTreeSet<i32>,
    /// Users whose groups allow the feature.
    pub group_allowed: BTreeSet<i32>,
}

/// Whether each user may configure a display username in this contest.
///
/// An empty list resolves to an empty map, as the reference returns before it
/// queries anything (`resolution.py:80-81`).
#[must_use]
pub fn resolve_config(inputs: &ConfigInputs, user_ids: &[i32]) -> BTreeMap<i32, bool> {
    if user_ids.is_empty() {
        return BTreeMap::new();
    }
    if let Some(policy) = inputs.contest {
        return user_ids
            .iter()
            .map(|user_id| (*user_id, policy.is_allow()))
            .collect();
    }
    user_ids
        .iter()
        .map(|user_id| (*user_id, config_allowed(inputs, *user_id)))
        .collect()
}

/// The user-scope row, then the group verdicts, then the default denial.
fn config_allowed(inputs: &ConfigInputs, user_id: i32) -> bool {
    if let Some(policy) = inputs.users.get(&user_id) {
        return policy.is_allow();
    }
    if inputs.group_denied.contains(&user_id) {
        return false;
    }
    inputs.group_allowed.contains(&user_id)
}
