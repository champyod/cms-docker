//! The refusals: who may stop a service, and every path that answers no.

use std::collections::BTreeSet;

use cms_api::{permits, tier_for, Access, Tier};
use cms_db::{resolve, EffectivePermissions, PermissionInputs};

/// The keys `permissions` registers; `all:all` is one of them, which is why it survives resolution.
const REGISTERED: [&str; 3] = ["all:all", "message:send", "question:ask"];

fn keys(list: &[&str]) -> BTreeSet<String> {
    list.iter().map(|key| (*key).to_owned()).collect()
}

/// The set the real resolver produces from these rows.
fn resolved(grants: &[&str], allows: &[&str], denies: &[&str]) -> EffectivePermissions {
    resolve(&PermissionInputs {
        is_enabled: true,
        group_grants: keys(grants),
        allow_overrides: keys(allows),
        deny_overrides: keys(denies),
        registered_keys: keys(&REGISTERED),
    })
}

fn superadmin() -> EffectivePermissions {
    resolved(&["all:all"], &[], &[])
}

fn authenticated_admin() -> EffectivePermissions {
    resolved(&["contest:read"], &[], &[])
}

fn admitted(effective: EffectivePermissions) -> Access {
    Access {
        enabled: true,
        effective,
    }
}

#[test]
fn an_authenticated_admin_may_read_resources_but_not_stop_one() {
    let access = admitted(authenticated_admin());
    assert!(permits(&access, "ResourceService", "get_resources"));
    assert!(
        !permits(&access, "ResourceService", "kill_service"),
        "an authenticated admin killed a service"
    );
    assert!(!permits(&access, "EvaluationService", "disable_worker"));
}

#[test]
fn a_superadmin_may_stop_a_service() {
    let access = admitted(superadmin());
    assert!(permits(&access, "ResourceService", "kill_service"));
    assert!(permits(&access, "ScoringService", "invalidate_submission"));
    assert!(permits(&access, "ResourceService", "get_resources"));
}

#[test]
fn a_messaging_admin_may_not_stop_a_service() {
    let access = admitted(resolved(&["message:send"], &[], &[]));
    assert_eq!(tier_for(&access.effective), Tier::Messaging);
    assert!(permits(&access, "ResourceService", "get_resources"));
    assert!(
        !permits(&access, "ResourceService", "kill_service"),
        "a messaging admin killed a service"
    );
}

#[test]
fn a_denied_wildcard_demotes_to_the_remaining_grants() {
    let effective = resolved(&["all:all"], &["message:send"], &["all:all"]);
    assert!(
        !effective.keys().contains("all:all"),
        "the deny left the wildcard in the set: {:?}",
        effective.keys()
    );
    assert_eq!(
        effective.keys().len(),
        1,
        "left behind: {:?}",
        effective.keys()
    );

    let access = admitted(effective);
    assert!(
        !permits(&access, "ResourceService", "kill_service"),
        "a denied wildcard still killed a service"
    );
    assert!(permits(&access, "ResourceService", "get_resources"));
}

#[test]
fn a_disabled_admin_is_refused_though_its_set_would_be_admitted() {
    let effective = superadmin();
    let enabled = Access {
        enabled: true,
        effective: effective.clone(),
    };
    assert!(
        permits(&enabled, "ResourceService", "kill_service"),
        "the fixture does not otherwise allow the call"
    );

    let disabled = Access {
        enabled: false,
        effective,
    };
    assert!(
        !permits(&disabled, "ResourceService", "kill_service"),
        "a disabled admin killed a service"
    );
    assert!(!permits(&disabled, "ResourceService", "get_resources"));
}
