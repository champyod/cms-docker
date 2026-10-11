use std::collections::BTreeMap;

use cms_ranking::overrides::{OverrideRow, Overrides};
use cms_ranking::scoring::{
    assemble_with, BoardRow, Ledger, ScoreMode, Subchange, Submission, TaskMode,
};

/// u0 scores 50 on t0 and belongs to team0; u1 scores 80 and has no team.
fn assemble(overrides: &Overrides) -> Ledger {
    let tasks = vec![TaskMode {
        key: "t0".to_string(),
        mode: ScoreMode::Max,
    }];
    let submissions = vec![
        Submission {
            key: "s0".to_string(),
            user: "u0".to_string(),
            task: "t0".to_string(),
            time: 1,
        },
        Submission {
            key: "s1".to_string(),
            user: "u1".to_string(),
            task: "t0".to_string(),
            time: 1,
        },
    ];
    let subchanges = vec![
        Subchange {
            key: "c0".to_string(),
            submission: "s0".to_string(),
            time: 2,
            score: Some(50.0),
            token: None,
            extra: None,
        },
        Subchange {
            key: "c1".to_string(),
            submission: "s1".to_string(),
            time: 2,
            score: Some(80.0),
            token: None,
            extra: None,
        },
    ];
    let teams = BTreeMap::from([("u0".to_string(), "team0".to_string())]);
    assemble_with(&tasks, &submissions, &subchanges, overrides, &teams)
        .expect("max is a known score mode")
}

fn override_row(kind: &str, key: &str, action: &str, value: Option<&str>) -> OverrideRow {
    OverrideRow {
        target_kind: kind.to_string(),
        target_key: key.to_string(),
        action: action.to_string(),
        payload: value.map(|value| serde_json::json!({ "value": value })),
    }
}

fn board_row<'a>(ledger: &'a Ledger, key: &str) -> &'a BoardRow {
    ledger
        .board()
        .iter()
        .find(|row| row.key == key)
        .unwrap_or_else(|| panic!("the board has no row for {key}"))
}

fn has_row(ledger: &Ledger, key: &str) -> bool {
    ledger.board().iter().any(|row| row.key == key)
}

#[test]
fn hide_removes_the_row_from_the_board() {
    let overrides = Overrides::fold(&[override_row("user", "u0", "hide", None)]);
    let ledger = assemble(&overrides);
    assert!(!has_row(&ledger, "u0"), "a hidden row leaves the board");
    assert!(!ledger.scores().contains_key("u0"));
    assert!(has_row(&ledger, "u1"));
}

#[test]
fn a_team_hide_removes_every_member() {
    let overrides = Overrides::fold(&[override_row("team", "team0", "hide", None)]);
    let ledger = assemble(&overrides);
    assert!(!has_row(&ledger, "u0"));
    assert!(has_row(&ledger, "u1"), "a user on another team stays");
}

#[test]
fn guest_adds_a_row_that_ranks_with_the_rest() {
    let overrides = Overrides::fold(&[override_row(
        "user",
        "visitor",
        "guest",
        Some("Visiting Team"),
    )]);
    let ledger = assemble(&overrides);
    let guest = board_row(&ledger, "visitor");
    assert_eq!(guest.name.as_deref(), Some("Visiting Team"));
    assert_eq!(guest.score, 0.0, "a guest has no participation");
    assert!(guest.rank.is_some(), "a guest is ranked like any other row");
}

#[test]
fn a_hidden_row_leaves_and_a_guest_row_joins() {
    let overrides = Overrides::fold(&[
        override_row("user", "u0", "hide", None),
        override_row("user", "visitor", "guest", Some("Visitor")),
    ]);
    let ledger = assemble(&overrides);
    assert!(!has_row(&ledger, "u0"));
    assert!(has_row(&ledger, "visitor"));
}

#[test]
fn rename_replaces_the_display_name() {
    let overrides = Overrides::fold(&[override_row("user", "u0", "rename", Some("Ada Lovelace"))]);
    let ledger = assemble(&overrides);
    assert_eq!(
        board_row(&ledger, "u0").name.as_deref(),
        Some("Ada Lovelace")
    );
    assert_eq!(board_row(&ledger, "u1").name, None);
}

#[test]
fn score_replaces_the_shown_score_and_moves_the_rank() {
    let overrides = Overrides::fold(&[override_row("user", "u1", "score", Some("10"))]);
    let ledger = assemble(&overrides);
    assert_eq!(board_row(&ledger, "u1").score, 10.0);
    // u0 (50) now outranks u1 (10).
    assert_eq!(board_row(&ledger, "u0").rank, Some(1));
    assert_eq!(board_row(&ledger, "u1").rank, Some(2));
}

#[test]
fn pin_sets_the_rank_regardless_of_score() {
    let overrides = Overrides::fold(&[override_row("user", "u1", "pin", Some("4"))]);
    let ledger = assemble(&overrides);
    assert_eq!(board_row(&ledger, "u1").rank, Some(4));
}

/// A user override outranks the team rule it would otherwise inherit.
#[test]
fn a_user_override_beats_the_team_rule() {
    let overrides = Overrides::fold(&[
        override_row("team", "team0", "rename", Some("Team Rule")),
        override_row("user", "u0", "rename", Some("Individual")),
    ]);
    let ledger = assemble(&overrides);
    assert_eq!(board_row(&ledger, "u0").name.as_deref(), Some("Individual"));
}

#[test]
fn a_malformed_override_is_skipped_and_counted() {
    let overrides = Overrides::fold(&[
        override_row("user", "u0", "rename", Some("Ada")),
        override_row("user", "u1", "bogus", Some("x")),
        override_row("user", "u1", "pin", Some("not-a-rank")),
        override_row("nonsense", "u1", "hide", None),
    ]);
    assert_eq!(overrides.skipped(), 3);
    let ledger = assemble(&overrides);
    assert_eq!(board_row(&ledger, "u0").name.as_deref(), Some("Ada"));
    assert!(
        has_row(&ledger, "u1"),
        "the skipped hide leaves the row on the board"
    );
    assert_eq!(ledger.skipped_overrides(), 3);
}
