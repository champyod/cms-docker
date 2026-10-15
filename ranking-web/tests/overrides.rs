use std::collections::BTreeMap;

use cms_ranking::board::{board_view, team_board_view, UserNames};
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

/// A hidden user's history and per-submission list leave with their board row, so
/// /history and /sublist cannot serve what /board withholds.
#[test]
fn a_hidden_user_leaves_the_history_and_the_sublist() {
    let overrides = Overrides::fold(&[override_row("user", "u0", "hide", None)]);
    let ledger = assemble(&overrides);

    assert!(
        ledger.history().iter().all(|entry| entry.0 != "u0"),
        "the hidden user leaves the history"
    );
    assert!(
        ledger.sublist("u0").is_empty(),
        "the hidden user leaves the sublist"
    );
    assert!(
        !ledger.sublist("u1").is_empty(),
        "a visible user keeps their own submissions"
    );
}

/// A hide on a task already absent from the replayed task set is the hide doing its job,
/// not a malformed submission, so it is not counted as a skipped subchange.
#[test]
fn a_hidden_task_is_not_counted_as_a_skipped_submission() {
    let overrides = Overrides::fold(&[override_row("task", "t0", "hide", None)]);
    let tasks: Vec<TaskMode> = Vec::new();
    let submissions = vec![Submission {
        key: "s0".to_string(),
        user: "u0".to_string(),
        task: "t0".to_string(),
        time: 1,
    }];
    let subchanges = vec![Subchange {
        key: "c0".to_string(),
        submission: "s0".to_string(),
        time: 2,
        score: Some(50.0),
        token: None,
        extra: None,
    }];

    let ledger = assemble_with(
        &tasks,
        &submissions,
        &subchanges,
        &overrides,
        &BTreeMap::new(),
    )
    .expect("an empty task set is replayable");

    assert_eq!(
        ledger.skipped_subchanges(),
        0,
        "the hide, not a malformed row, removed the submission"
    );
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

type NamedUsers = BTreeMap<String, UserNames>;

fn names(rows: &[(&str, &str, &str, Option<&str>)]) -> NamedUsers {
    rows.iter()
        .map(|(key, f_name, l_name, team)| {
            (
                key.to_string(),
                UserNames {
                    f_name: f_name.to_string(),
                    l_name: l_name.to_string(),
                    team: team.map(str::to_string),
                },
            )
        })
        .collect()
}

/// The view names each row from the projection and carries the team, so a page can
/// render it without a second lookup.
#[test]
fn the_view_names_rows_and_carries_the_team() {
    let overrides = Overrides::fold(&[]);
    let ledger = assemble(&overrides);
    let users = names(&[
        ("u0", "Grace", "Hopper", Some("team0")),
        ("u1", "Real", "Name", None),
    ]);
    let view = board_view(ledger.board(), &users);
    let grace = &view["u0"];
    assert_eq!(
        (grace.f_name.as_str(), grace.l_name.as_str()),
        ("Grace", "Hopper")
    );
    assert_eq!(grace.team.as_deref(), Some("team0"));
    assert_eq!(grace.score, 50.0);
    assert_eq!(grace.rank, 2);
    assert_eq!(view["u1"].rank, 1);
}

/// A rename fills the two name columns from the one override string and keeps the
/// team the projection holds, so a rename never drops a team.
#[test]
fn a_rename_fills_the_name_columns_and_keeps_the_team() {
    let overrides = Overrides::fold(&[override_row("user", "u0", "rename", Some("Ada Lovelace"))]);
    let ledger = assemble(&overrides);
    let view = board_view(
        ledger.board(),
        &names(&[("u0", "Grace", "Hopper", Some("team0"))]),
    );
    let ada = &view["u0"];
    assert_eq!(
        (ada.f_name.as_str(), ada.l_name.as_str()),
        ("Ada", "Lovelace")
    );
    assert_eq!(ada.team.as_deref(), Some("team0"));
}

/// The team board sums visible members, names the team from the projection and ranks it
/// the way the user board ranks users.
#[test]
fn the_team_board_sums_members_and_names_the_team() {
    let overrides = Overrides::fold(&[override_row("team", "team0", "rename", Some("Team Zero"))]);
    let ledger = assemble(&overrides);
    let users = names(&[("u0", "Grace", "Hopper", Some("team0"))]);
    let team_names = BTreeMap::from([("team0".to_string(), "Raw Team".to_string())]);
    let view = team_board_view(ledger.board(), &users, &team_names, &overrides);
    assert_eq!(view["team0"].name, "Team Zero");
    assert_eq!(view["team0"].members, vec!["u0".to_string()]);
    assert_eq!(view["team0"].rank, 1);
}

/// A team score override replaces the summed total rather than each member's row, so a
/// two-member team pinned to 10 does not read 20.
#[test]
fn a_team_score_override_replaces_the_summed_total() {
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
            key: "s2".to_string(),
            user: "u2".to_string(),
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
            key: "c2".to_string(),
            submission: "s2".to_string(),
            time: 2,
            score: Some(30.0),
            token: None,
            extra: None,
        },
    ];
    let teams = BTreeMap::from([
        ("u0".to_string(), "team0".to_string()),
        ("u2".to_string(), "team0".to_string()),
    ]);
    let overrides = Overrides::fold(&[override_row("team", "team0", "score", Some("10"))]);
    let ledger =
        assemble_with(&tasks, &submissions, &subchanges, &overrides, &teams).expect("max is known");
    let users = names(&[
        ("u0", "A", "One", Some("team0")),
        ("u2", "B", "Two", Some("team0")),
    ]);
    let view = team_board_view(ledger.board(), &users, &BTreeMap::new(), &overrides);
    assert_eq!(view["team0"].score, 10.0);
    assert_eq!(
        view["team0"].members,
        vec!["u0".to_string(), "u2".to_string()]
    );
    assert_eq!(view["team0"].rank, 1);
}

/// A guest has no projected row, so its override is the only name it has and it
/// carries no team.
#[test]
fn a_guest_is_named_by_its_override_with_no_team() {
    let overrides = Overrides::fold(&[override_row(
        "user",
        "visitor",
        "guest",
        Some("Visiting Team"),
    )]);
    let ledger = assemble(&overrides);
    let view = board_view(
        ledger.board(),
        &names(&[("u0", "Grace", "Hopper", Some("team0"))]),
    );
    let guest = &view["visitor"];
    assert_eq!(
        (guest.f_name.as_str(), guest.l_name.as_str()),
        ("Visiting", "Team")
    );
    assert_eq!(guest.team, None);
    assert_eq!(guest.score, 0.0);
}

/// A whole-board hide blanks the board and its scores, and is not counted as a skip.
/// The panel has always offered this target; before the fix the crate dropped the row.
#[test]
fn a_board_hide_blanks_the_board_and_the_scores() {
    let overrides = Overrides::fold(&[override_row("ranking", "*", "hide", None)]);
    assert!(overrides.board_hidden());
    assert_eq!(overrides.skipped(), 0);
    let ledger = assemble(&overrides);
    assert!(ledger.board().is_empty(), "no row survives a board hide");
    assert!(ledger.scores().is_empty());
}

/// A board hide must not let a guest row re-enter through the ranking pass.
#[test]
fn a_board_hide_keeps_guest_rows_off_the_board() {
    let overrides = Overrides::fold(&[
        override_row("ranking", "*", "hide", None),
        override_row("user", "visitor", "guest", Some("Visitor")),
    ]);
    let ledger = assemble(&overrides);
    assert!(ledger.board().is_empty());
}

/// A board freeze carries the projection cutoff. It was dropped as an unknown target
/// before, so the board never froze.
#[test]
fn a_board_freeze_sets_the_cutoff() {
    let overrides = Overrides::fold(&[override_row("ranking", "*", "freeze", Some("1700000000"))]);
    assert_eq!(overrides.frozen_at(), Some(1_700_000_000));
    assert_eq!(overrides.skipped(), 0);
    assert!(!overrides.board_hidden());
}

/// Only hide and freeze name the whole board; every other action needs a user or team,
/// so on the board target it is refused and counted rather than silently dropped.
#[test]
fn a_board_action_that_names_nobody_is_skipped() {
    let overrides = Overrides::fold(&[override_row("ranking", "*", "rename", Some("Board"))]);
    assert_eq!(overrides.skipped(), 1);
    assert!(!overrides.board_hidden());
}
