use std::cmp::Ordering;
use std::collections::BTreeMap;

use serde::Serialize;

use crate::overrides::{Overrides, TargetKind};

/// One board row: a user, with the name, aggregate score and rank an override may set.
#[derive(Debug, Clone, PartialEq)]
pub struct BoardRow {
    pub key: String,
    pub name: Option<String>,
    pub score: f64,
    pub rank: Option<i64>,
}

/// Who a projected key is, as `ranking_users` names them. The ledger knows no names,
/// so the serving layer joins this onto each row.
#[derive(Debug, Clone, PartialEq)]
pub struct UserNames {
    pub f_name: String,
    pub l_name: String,
    pub team: Option<String>,
}

/// One row of the board the page draws: a display name, the team it carries, the
/// override-applied score and the server-assigned rank. The page renders these
/// directly, so a rename and a pin reach it without a client-side recompute.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct BoardEntry {
    pub f_name: String,
    pub l_name: String,
    pub team: Option<String>,
    pub score: f64,
    pub rank: i64,
}

/// Joins the projection's names onto the override-shaped rows. A rename replaces the
/// whole display name, so it fills `f_name` and clears `l_name`; a guest has no
/// projected row at all and is named only by its override.
pub fn board_view(
    rows: &[BoardRow],
    users: &BTreeMap<String, UserNames>,
) -> BTreeMap<String, BoardEntry> {
    rows.iter()
        .map(|row| {
            let known = users.get(&row.key);
            let (f_name, l_name) = match row.name.as_deref() {
                Some(renamed) => split_name(renamed),
                None => known
                    .map(|user| (user.f_name.clone(), user.l_name.clone()))
                    .unwrap_or_else(|| (row.key.clone(), String::new())),
            };
            let entry = BoardEntry {
                f_name,
                l_name,
                team: known.and_then(|user| user.team.clone()),
                score: row.score,
                rank: row.rank.unwrap_or(0),
            };
            (row.key.clone(), entry)
        })
        .collect()
}

/// One team on the team board: its display name, the aggregate score and rank an
/// override may set, and the visible member keys it is built from.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TeamEntry {
    pub name: String,
    pub score: f64,
    pub rank: i64,
    pub members: Vec<String>,
}

/// The internal accumulator: a team's rank starts unset so a pin can be told from a
/// rank of zero the same way a user row is.
struct TeamAcc {
    name: String,
    score: f64,
    rank: Option<i64>,
    members: Vec<String>,
}

/// The team board: members summed per team, a team score override replacing the sum,
/// a team rename naming it and a team pin setting its rank. A hidden team is dropped.
pub fn team_board_view(
    rows: &[BoardRow],
    users: &BTreeMap<String, UserNames>,
    team_names: &BTreeMap<String, String>,
    overrides: &Overrides,
) -> BTreeMap<String, TeamEntry> {
    let mut acc: BTreeMap<String, TeamAcc> = BTreeMap::new();
    for row in rows {
        let Some(team) = users.get(&row.key).and_then(|user| user.team.as_deref()) else {
            continue;
        };
        if overrides.hides(TargetKind::Team, team) {
            continue;
        }
        let entry = acc.entry(team.to_string()).or_insert_with(|| TeamAcc {
            name: overrides
                .renamed(TargetKind::Team, team)
                .map(str::to_string)
                .or_else(|| team_names.get(team).cloned())
                .unwrap_or_else(|| team.to_string()),
            score: 0.0,
            rank: overrides.pinned(TargetKind::Team, team),
            members: Vec::new(),
        });
        entry.members.push(row.key.clone());
        entry.score += row.score;
    }
    for (team, entry) in acc.iter_mut() {
        if let Some(score) = overrides.scored(TargetKind::Team, team) {
            entry.score = score;
        }
        entry.members.sort();
    }
    let mut ordered: Vec<(String, TeamAcc)> = acc.into_iter().collect();
    ordered.sort_by(|(left_key, left), (right_key, right)| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(Ordering::Equal)
            .then_with(|| left_key.cmp(right_key))
    });
    let mut rank = 0;
    let mut previous: Option<f64> = None;
    let mut out: BTreeMap<String, TeamEntry> = BTreeMap::new();
    for (position, (key, mut entry)) in ordered.into_iter().enumerate() {
        if previous != Some(entry.score) {
            rank = position as i64 + 1;
            previous = Some(entry.score);
        }
        let final_rank = entry.rank.take().unwrap_or(rank);
        out.insert(
            key,
            TeamEntry {
                name: entry.name,
                score: entry.score,
                rank: final_rank,
                members: entry.members,
            },
        );
    }
    out
}

/// A single override name fills the board's two name columns: everything before the
/// first space is the first name, the rest the last. One word leaves the last name empty.
fn split_name(name: &str) -> (String, String) {
    match name.split_once(char::is_whitespace) {
        Some((first, rest)) => (first.to_string(), rest.trim().to_string()),
        None => (name.to_string(), String::new()),
    }
}

/// Whether the user, or the team they belong to, is hidden.
pub fn is_hidden(overrides: &Overrides, user: &str, team: Option<&str>) -> bool {
    overrides.hides(TargetKind::User, user)
        || team.is_some_and(|team| overrides.hides(TargetKind::Team, team))
}

/// Adds this task score to the user's row; a score override replaces the aggregate.
pub fn record_row(
    rows: &mut BTreeMap<String, BoardRow>,
    overrides: &Overrides,
    user: &str,
    team: Option<&str>,
    value: f64,
) {
    let override_score = scored_override(overrides, user, team);
    let row = rows.entry(user.to_string()).or_insert_with(|| BoardRow {
        key: user.to_string(),
        name: renamed_override(overrides, user, team).map(str::to_string),
        rank: pinned_override(overrides, user, team),
        score: override_score.unwrap_or(0.0),
    });
    if override_score.is_none() && value > 0.0 {
        row.score += value;
    }
}

/// Adds the guests, orders by score, and gives each row its rank; a pin replaces it.
pub fn rank_rows(mut rows: BTreeMap<String, BoardRow>, overrides: &Overrides) -> Vec<BoardRow> {
    add_guest_rows(&mut rows, overrides);
    let mut ordered: Vec<BoardRow> = rows.into_values().collect();
    ordered.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(Ordering::Equal)
            .then_with(|| left.key.cmp(&right.key))
    });
    assign_ranks(&mut ordered);
    ordered
}

/// A user override wins over their team's, so a team rule never masks an individual.
fn renamed_override<'a>(
    overrides: &'a Overrides,
    user: &str,
    team: Option<&str>,
) -> Option<&'a str> {
    overrides
        .renamed(TargetKind::User, user)
        .or_else(|| team.and_then(|team| overrides.renamed(TargetKind::Team, team)))
}

fn scored_override(overrides: &Overrides, user: &str, team: Option<&str>) -> Option<f64> {
    overrides
        .scored(TargetKind::User, user)
        .or_else(|| team.and_then(|team| overrides.scored(TargetKind::Team, team)))
}

fn pinned_override(overrides: &Overrides, user: &str, team: Option<&str>) -> Option<i64> {
    overrides
        .pinned(TargetKind::User, user)
        .or_else(|| team.and_then(|team| overrides.pinned(TargetKind::Team, team)))
}

/// A guest is a row with no participation, ranked at its override score or zero.
fn add_guest_rows(rows: &mut BTreeMap<String, BoardRow>, overrides: &Overrides) {
    for guest in overrides.guests() {
        if overrides.hides(guest.kind, &guest.key) {
            continue;
        }
        rows.entry(guest.key.clone()).or_insert_with(|| BoardRow {
            key: guest.key.clone(),
            name: Some(guest.name.clone()),
            score: overrides.scored(guest.kind, &guest.key).unwrap_or(0.0),
            rank: overrides.pinned(guest.kind, &guest.key),
        });
    }
}

/// Competition ranking: equal scores share a rank; a pinned rank is left as set.
fn assign_ranks(rows: &mut [BoardRow]) {
    let mut rank = 0;
    let mut previous = None;
    for (position, row) in rows.iter_mut().enumerate() {
        if previous != Some(row.score) {
            rank = position as i64 + 1;
            previous = Some(row.score);
        }
        if row.rank.is_none() {
            row.rank = Some(rank);
        }
    }
}
