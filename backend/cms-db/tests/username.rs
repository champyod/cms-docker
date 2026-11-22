//! The display-username precedence, and the five tables it reads.
//!
//! Each case is a set of policy rows the reference's `resolve_username_config`
//! (`src/cms/db/username/resolution.py:72-91`) settles: contest over user over
//! group, a group deny over a group allow, and no row meaning no. A narrower
//! scope must not reopen a wider one, which is the property a looser port would
//! lose first. Nothing opens a connection.

use std::collections::{BTreeMap, BTreeSet};

use cms_db::{
    resolve_config, ConfigInputs, Policy, CONTESTANT_GROUP, CONTESTANT_GROUP_MEMBERSHIP,
    CONTEST_USERNAME, CONTEST_USERNAME_HISTORY, USERNAME_POLICY,
};

const ADA: i32 = 1;

fn ids(values: &[i32]) -> BTreeSet<i32> {
    values.iter().copied().collect()
}

fn users(values: &[(i32, Policy)]) -> BTreeMap<i32, Policy> {
    values.iter().copied().collect()
}

#[test]
fn a_contest_policy_decides_for_every_participant() {
    let inputs = ConfigInputs {
        contest: Some(Policy::Allow),
        users: users(&[(ADA, Policy::Deny)]),
        ..ConfigInputs::default()
    };

    assert_eq!(
        resolve_config(&inputs, &[ADA, 2]),
        BTreeMap::from([(ADA, true), (2, true)])
    );
}

#[test]
fn a_contest_denial_is_not_reopened_by_a_user_allow() {
    let inputs = ConfigInputs {
        contest: Some(Policy::Deny),
        users: users(&[(ADA, Policy::Allow)]),
        group_allowed: ids(&[ADA]),
        ..ConfigInputs::default()
    };

    assert_eq!(
        resolve_config(&inputs, &[ADA]),
        BTreeMap::from([(ADA, false)])
    );
}

#[test]
fn a_user_policy_beats_the_group_verdicts_in_both_directions() {
    let allowed = ConfigInputs {
        users: users(&[(ADA, Policy::Allow)]),
        group_denied: ids(&[ADA]),
        ..ConfigInputs::default()
    };
    let denied = ConfigInputs {
        users: users(&[(ADA, Policy::Deny)]),
        group_allowed: ids(&[ADA]),
        ..ConfigInputs::default()
    };

    assert_eq!(
        resolve_config(&allowed, &[ADA]),
        BTreeMap::from([(ADA, true)])
    );
    assert_eq!(
        resolve_config(&denied, &[ADA]),
        BTreeMap::from([(ADA, false)])
    );
}

#[test]
fn a_deny_on_any_group_beats_an_allow_on_another() {
    let inputs = ConfigInputs {
        group_denied: ids(&[ADA]),
        group_allowed: ids(&[ADA]),
        ..ConfigInputs::default()
    };

    assert_eq!(
        resolve_config(&inputs, &[ADA]),
        BTreeMap::from([(ADA, false)])
    );
}

#[test]
fn a_group_allow_alone_permits_the_feature() {
    let inputs = ConfigInputs {
        group_allowed: ids(&[ADA]),
        ..ConfigInputs::default()
    };

    assert_eq!(
        resolve_config(&inputs, &[ADA]),
        BTreeMap::from([(ADA, true)])
    );
}

#[test]
fn no_policy_anywhere_denies() {
    assert_eq!(
        resolve_config(&ConfigInputs::default(), &[ADA]),
        BTreeMap::from([(ADA, false)])
    );
}

#[test]
fn an_empty_user_list_resolves_to_an_empty_map() {
    let inputs = ConfigInputs {
        contest: Some(Policy::Allow),
        ..ConfigInputs::default()
    };

    assert!(resolve_config(&inputs, &[]).is_empty());
}

#[test]
fn only_the_two_stored_policies_are_named() {
    assert_eq!(Policy::of("allow"), Some(Policy::Allow));
    assert_eq!(Policy::of("deny"), Some(Policy::Deny));
    assert_eq!(Policy::of("ALLOW"), None);
    assert_eq!(Policy::of(""), None);
}

#[test]
fn the_username_declarations_validate_and_carry_their_keys() {
    for declaration in [
        CONTESTANT_GROUP,
        CONTESTANT_GROUP_MEMBERSHIP,
        USERNAME_POLICY,
        CONTEST_USERNAME,
        CONTEST_USERNAME_HISTORY,
    ] {
        assert_eq!(declaration.validate(), Ok(()), "{}", declaration.table);
    }

    let columns: Vec<&str> = CONTEST_USERNAME
        .columns
        .iter()
        .map(|column| column.name)
        .collect();
    assert_eq!(
        columns,
        [
            "id",
            "username",
            "updated_at",
            "updated_by_admin_id",
            "participation_id",
            "contest_id",
            "user_id",
        ]
    );
    assert_eq!(
        CONTEST_USERNAME.relationships,
        ["updated_by_admin", "participation", "contest", "user"]
    );
}
