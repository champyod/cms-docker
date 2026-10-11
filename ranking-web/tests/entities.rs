//! The entity wire shapes, checked without a database by comparing the serialiser
//! against the captured bodies.

use std::collections::BTreeMap;

use cms_ranking::entities::{Contest, Task, Team, User};
use cms_ranking::json::to_bytes;
use cms_ranking::scoring::SubmissionEntry;

fn captured(name: &str) -> String {
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/parity/captured")
        .join(name);
    std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("cannot read {}: {error}", path.display()))
        .trim_end()
        .to_string()
}

fn rendered<T: serde::Serialize>(value: &T) -> String {
    String::from_utf8(to_bytes(value).expect("the value serialises")).expect("utf-8")
}

fn task() -> Task {
    Task {
        key: "t0".to_string(),
        name: "A Plus B".to_string(),
        short_name: "aplusb".to_string(),
        contest: "test".to_string(),
        max_score: 100.0,
        extra_headers: serde_json::json!(["Subtask 0 (30)", "Subtask 1 (70)"]),
        display_order: 0,
        score_mode: "max_subtask".to_string(),
        score_precision: 0,
    }
}

#[test]
fn a_task_is_byte_for_byte_the_captured_body() {
    assert_eq!(rendered(&task()), captured("task_one.json"));
}

#[test]
fn a_contest_keeps_the_captured_field_order() {
    let contest = Contest {
        key: "c0".to_string(),
        name: "Parity Fixture Contest".to_string(),
        begin: 1700000000,
        end: 1700036000,
        score_precision: 2,
    };
    let expected = r#"{"name": "Parity Fixture Contest", "begin": 1700000000, "end": 1700036000, "score_precision": 2}"#;
    assert_eq!(rendered(&contest), expected);
}

#[test]
fn a_user_may_name_a_team_or_null() {
    let member = User {
        key: "u0".to_string(),
        f_name: "Ada".to_string(),
        l_name: "Zero".to_string(),
        team: Some("team0".to_string()),
    };
    assert_eq!(
        rendered(&member),
        r#"{"f_name": "Ada", "l_name": "Zero", "team": "team0"}"#
    );
    let solo = User {
        key: "u1".to_string(),
        team: None,
        ..member
    };
    assert_eq!(
        rendered(&solo),
        r#"{"f_name": "Ada", "l_name": "Zero", "team": null}"#
    );
}

#[test]
fn a_team_is_just_its_name() {
    let team = Team {
        key: "team0".to_string(),
        name: "Fixture Team".to_string(),
    };
    assert_eq!(rendered(&team), r#"{"name": "Fixture Team"}"#);
}

#[test]
fn a_user_list_is_keyed_by_key() {
    let mut users: BTreeMap<String, User> = BTreeMap::new();
    users.insert(
        "u0".to_string(),
        User {
            key: "u0".to_string(),
            f_name: "Ada".to_string(),
            l_name: "Zero".to_string(),
            team: Some("team0".to_string()),
        },
    );
    users.insert(
        "u1".to_string(),
        User {
            key: "u1".to_string(),
            f_name: "Bob".to_string(),
            l_name: "One".to_string(),
            team: None,
        },
    );
    let expected = r#"{"u0": {"f_name": "Ada", "l_name": "Zero", "team": "team0"}, "u1": {"f_name": "Bob", "l_name": "One", "team": null}}"#;
    assert_eq!(rendered(&users), expected);
}

/// The Python SubListHandler serialises Submission.__dict__, so the element carries
/// the store key and the scorer's per-submission score, token and extra.
#[test]
fn a_sublist_element_is_the_full_submission_dict() {
    let rows = vec![SubmissionEntry {
        user: "u0".to_string(),
        task: "t0".to_string(),
        time: 1700001000,
        key: "s0".to_string(),
        score: 50.0,
        token: false,
        extra: vec![],
    }];
    assert_eq!(
        rendered(&rows),
        r#"[{"user": "u0", "task": "t0", "time": 1700001000, "key": "s0", "score": 50.0, "token": false, "extra": []}]"#
    );
    let empty: Vec<SubmissionEntry> = Vec::new();
    assert_eq!(rendered(&empty), "[]");
}
