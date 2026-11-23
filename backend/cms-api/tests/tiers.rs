//! The three lists and the tier a resolved set puts its holder in.

use std::collections::BTreeSet;

use cms_api::{
    allows, has_messaging, tier_for, Tier, RPCS_ALLOWED_FOR_ALL_ADDITIONS,
    RPCS_ALLOWED_FOR_AUTHENTICATED, RPCS_ALLOWED_FOR_MESSAGING_ADDITIONS,
};
use cms_db::{resolve, EffectivePermissions, PermissionInputs};

/// The keys `permissions` registers; `all:all` is one of them, which is why it survives resolution.
const REGISTERED: [&str; 3] = ["all:all", "message:send", "question:ask"];

/// `RPCS_ALLOWED_FOR_AUTHENTICATED`, transcribed from `rpc_authorization.py:28-34`.
const AUTHENTICATED: [(&str, &str); 5] = [
    ("AdminWebServer", "submissions_status"),
    ("ResourceService", "get_resources"),
    ("EvaluationService", "workers_status"),
    ("EvaluationService", "queue_status"),
    ("LogService", "last_messages"),
];

/// The six pairs the reference adds for the wildcard tier (`rpc_authorization.py:40-47`).
const SERVICE_CONTROL: [(&str, &str); 6] = [
    ("ResourceService", "kill_service"),
    ("ResourceService", "toggle_autorestart"),
    ("EvaluationService", "enable_worker"),
    ("EvaluationService", "disable_worker"),
    ("EvaluationService", "invalidate_submission"),
    ("ScoringService", "invalidate_submission"),
];

fn keys(list: &[&str]) -> BTreeSet<String> {
    list.iter().map(|key| (*key).to_owned()).collect()
}

/// The set the real resolver produces from these rows.
fn resolved(grants: &[&str]) -> EffectivePermissions {
    resolve(&PermissionInputs {
        is_enabled: true,
        group_grants: keys(grants),
        registered_keys: keys(&REGISTERED),
        ..PermissionInputs::default()
    })
}

#[test]
fn the_wildcard_survives_resolution_and_decides_the_widest_tier() {
    let effective = resolved(&["all:all"]);
    assert!(
        effective.keys().contains("all:all"),
        "the resolver dropped the wildcard: {:?}",
        effective.keys()
    );
    assert_eq!(tier_for(&effective), Tier::All);
    assert_eq!(tier_for(&resolved(&["contest:read"])), Tier::Authenticated);
}

#[test]
fn the_three_lists_hold_the_reference_pairs() {
    assert_eq!(
        RPCS_ALLOWED_FOR_AUTHENTICATED.len(),
        5,
        "the floor tier moved"
    );
    assert_eq!(
        RPCS_ALLOWED_FOR_MESSAGING_ADDITIONS.len(),
        0,
        "the reference's messaging addition is empty"
    );
    assert_eq!(
        RPCS_ALLOWED_FOR_ALL_ADDITIONS.len(),
        6,
        "the control tier moved"
    );

    for (service, method) in AUTHENTICATED {
        assert!(
            allows(Tier::Authenticated, service, method),
            "{service}.{method} left the floor tier"
        );
        assert!(allows(Tier::Messaging, service, method));
        assert!(allows(Tier::All, service, method));
    }
    for (service, method) in SERVICE_CONTROL {
        assert!(
            !allows(Tier::Authenticated, service, method),
            "{service}.{method} reached the floor tier"
        );
        assert!(
            !allows(Tier::Messaging, service, method),
            "{service}.{method} reached the messaging tier"
        );
        assert!(
            allows(Tier::All, service, method),
            "{service}.{method} left the wildcard tier"
        );
    }
    assert!(
        !allows(Tier::All, "AdminWebServer", "delete_admin"),
        "an unlisted pair was admitted by the widest tier"
    );
}

#[test]
fn the_message_send_key_grants_the_messaging_tier() {
    let effective = resolved(&["message:send"]);
    assert!(has_messaging(&effective));
    assert_eq!(tier_for(&effective), Tier::Messaging);
}

#[test]
fn a_question_key_grants_the_messaging_tier() {
    let effective = resolved(&["question:ask"]);
    assert!(has_messaging(&effective));
    assert_eq!(tier_for(&effective), Tier::Messaging);
}

#[test]
fn an_announcement_key_grants_the_messaging_tier() {
    let effective = resolved(&["announcement:announce"]);
    assert!(has_messaging(&effective));
    assert_eq!(tier_for(&effective), Tier::Messaging);
}
