//! The key sets `get_effective_permissions` resolves, and the order it does.
//!
//! Every shape here is a set of keys the `groups`, `admin_permission_overrides`
//! and `permissions` tables actually hold, so the resolution is a pure function
//! of what the rows said. The order is the Python side's: groups and allows
//! united, the wildcard expanded into every registered key, then the denies
//! subtracted, and nothing at all for a disabled or missing admin. Nothing opens
//! a connection.

use std::collections::BTreeSet;

use cms_db::{resolve, Effect, EffectivePermissions, PermissionInputs, WILDCARD_PERMISSION};

fn keys(values: &[&str]) -> BTreeSet<String> {
    values.iter().map(|value| (*value).to_string()).collect()
}

#[test]
fn group_grants_and_allow_overrides_are_unioned() {
    let inputs = PermissionInputs {
        is_enabled: true,
        group_grants: keys(&["contest:read"]),
        allow_overrides: keys(&["contest:update"]),
        ..PermissionInputs::default()
    };

    let effective = resolve(&inputs);

    assert!(effective.grants("contest:read"));
    assert!(effective.grants("contest:update"));
    assert!(!effective.grants("contest:delete"));
}

#[test]
fn a_deny_wins_over_both_the_groups_and_the_wildcard() {
    let with_wildcard = PermissionInputs {
        is_enabled: true,
        group_grants: keys(&[WILDCARD_PERMISSION, "contest:read"]),
        deny_overrides: keys(&["contest:read"]),
        registered_keys: keys(&["contest:read", "contest:delete"]),
        ..PermissionInputs::default()
    };

    let effective = resolve(&with_wildcard);

    assert!(!effective.grants("contest:read"));
    assert!(effective.grants("contest:delete"));
}

#[test]
fn denying_the_wildcard_itself_leaves_nothing_behind() {
    let inputs = PermissionInputs {
        is_enabled: true,
        group_grants: keys(&[WILDCARD_PERMISSION]),
        deny_overrides: keys(&[WILDCARD_PERMISSION]),
        registered_keys: keys(&["contest:read", "contest:delete"]),
        ..PermissionInputs::default()
    };

    let effective = resolve(&inputs);

    assert!(effective.is_empty());
    assert!(!effective.grants("contest:read"));
    assert_eq!(effective, EffectivePermissions::none());
}

#[test]
fn a_disabled_or_missing_admin_resolves_to_nothing() {
    let inputs = PermissionInputs {
        is_enabled: false,
        group_grants: keys(&[WILDCARD_PERMISSION]),
        registered_keys: keys(&["contest:read"]),
        ..PermissionInputs::default()
    };

    assert_eq!(resolve(&inputs), EffectivePermissions::none());
    assert!(resolve(&inputs).is_empty());
}

#[test]
fn an_unexpanded_wildcard_alone_still_grants_everything() {
    let inputs = PermissionInputs {
        is_enabled: true,
        group_grants: keys(&[WILDCARD_PERMISSION]),
        ..PermissionInputs::default()
    };

    let effective = resolve(&inputs);

    assert!(effective.grants("contest:read"));
    assert!(effective.grants("never:registered"));
    assert_eq!(effective.keys(), &keys(&[WILDCARD_PERMISSION]));
}

#[test]
fn an_expanded_wildcard_stops_granting_a_key_it_never_registered() {
    let inputs = PermissionInputs {
        is_enabled: true,
        group_grants: keys(&[WILDCARD_PERMISSION]),
        registered_keys: keys(&["contest:read"]),
        ..PermissionInputs::default()
    };

    let effective = resolve(&inputs);

    assert!(effective.grants("contest:read"));
    assert!(!effective.grants("never:registered"));
    assert!(effective.keys().contains(WILDCARD_PERMISSION));
}

#[test]
fn an_effect_column_the_python_side_matches_neither_grants_nor_denies() {
    assert_eq!(Effect::of("allow"), Some(Effect::Allow));
    assert_eq!(Effect::of("deny"), Some(Effect::Deny));
    assert_eq!(Effect::of(""), None);
    assert_eq!(Effect::of("DENY"), None);
    assert_eq!(Effect::of("permitted"), None);
}
