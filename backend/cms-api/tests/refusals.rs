//! The refusals: who may stop a service, and every path that answers no.

use std::collections::BTreeSet;

use cms_api::{authorize, permits, tier_for, Access, AccessError, Tier};
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

fn read_admitted(effective: EffectivePermissions) -> Result<Option<Access>, AccessError> {
    Ok(Some(admitted(effective)))
}

fn read_failed() -> Result<Option<Access>, AccessError> {
    Err(AccessError::Row(sqlx::Error::RowNotFound))
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

#[tokio::test]
async fn an_absent_admin_id_is_refused_before_the_read_runs() {
    let present = authorize(
        |_| async { read_admitted(superadmin()) },
        Some(7),
        "ResourceService",
        "kill_service",
    )
    .await;
    assert!(present, "the same read admits a present id");

    let absent = authorize(
        |_| async { read_admitted(superadmin()) },
        None,
        "ResourceService",
        "kill_service",
    )
    .await;
    assert!(!absent, "an absent admin id was admitted");
}

#[tokio::test]
async fn a_failed_read_is_refused_where_the_same_read_admits() {
    let refused = authorize(
        |_| async { read_failed() },
        Some(7),
        "ResourceService",
        "get_resources",
    )
    .await;
    assert!(
        !refused,
        "a failed read fell through to the floor tier's get_resources"
    );

    let admitted_read = authorize(
        |_| async { read_admitted(authenticated_admin()) },
        Some(7),
        "ResourceService",
        "get_resources",
    )
    .await;
    assert!(admitted_read);
}
