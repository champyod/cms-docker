use std::cmp::Ordering;
use std::collections::BTreeMap;

use serde::Serialize;

use crate::overrides::{ContestScope, Overrides, TargetKind};

/// One board row: a user, with the name, aggregate score and rank an override may set.
#[derive(Debug, Clone, PartialEq)]
pub struct BoardRow {
    pub key: String,
    pub contest_id: i32,
    pub contest: String,
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
    /// The real user key this row belongs to; the map key is a row id, so a user shown
    /// in two contests does not overwrite one of its own rows.
    pub user: String,
    pub contest_id: i32,
    pub contest: String,
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
    let mut seen: BTreeMap<String, usize> = BTreeMap::new();
    for row in rows {
        *seen.entry(row.key.clone()).or_default() += 1;
    }
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
                user: row.key.clone(),
                contest_id: row.contest_id,
                contest: row.contest.clone(),
                f_name,
                l_name,
                team: known.and_then(|user| user.team.clone()),
                score: row.score,
                rank: row.rank.unwrap_or(0),
            };
            let id = if seen.get(row.key.as_str()).copied().unwrap_or(0) > 1 {
                format!("{}{}{}", row.key, '\u{1f}', row.contest_id)
            } else {
                row.key.clone()
            };
            (id, entry)
        })
        .collect()
}

/// One team on the team board: its display name, the aggregate score and rank an
/// override may set, and the visible member keys it is built from.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TeamEntry {
    pub contest_id: i32,
    pub contest: String,
    pub name: String,
    pub score: f64,
    pub rank: i64,
    pub members: Vec<String>,
}

/// The internal accumulator: a team's rank starts unset so a pin can be told from a
/// rank of zero the same way a user row is.
struct TeamAcc {
    contest_id: i32,
    contest: String,
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
    let mut acc: BTreeMap<(i32, String), TeamAcc> = BTreeMap::new();
    for row in rows {
        let Some(team) = users.get(&row.key).and_then(|user| user.team.as_deref()) else {
            continue;
        };
        let scope = overrides.scope(row.contest_id);
        if scope.hides(TargetKind::Team, team) {
            continue;
        }
        let entry = acc
            .entry((row.contest_id, team.to_string()))
            .or_insert_with(|| TeamAcc {
                contest_id: row.contest_id,
                contest: row.contest.clone(),
                name: scope
                    .renamed(TargetKind::Team, team)
                    .map(str::to_string)
                    .or_else(|| team_names.get(team).cloned())
                    .unwrap_or_else(|| team.to_string()),
                score: 0.0,
                rank: scope.pinned(TargetKind::Team, team),
                members: Vec::new(),
            });
        entry.members.push(row.key.clone());
        entry.score += row.score;
    }
    for ((_contest_id, team), entry) in acc.iter_mut() {
        if let Some(score) = overrides
            .scope(entry.contest_id)
            .scored(TargetKind::Team, team)
        {
            entry.score = score;
        }
        entry.members.sort();
    }
    let mut ordered: Vec<((i32, String), TeamAcc)> = acc.into_iter().collect();
    ordered.sort_by(
        |((left_contest, left_key), left), ((right_contest, right_key), right)| {
            left_contest
                .cmp(right_contest)
                .then_with(|| {
                    right
                        .score
                        .partial_cmp(&left.score)
                        .unwrap_or(Ordering::Equal)
                })
                .then_with(|| left_key.cmp(right_key))
        },
    );
    let mut out: BTreeMap<String, TeamEntry> = BTreeMap::new();
    let mut previous_contest = None;
    let mut rank = 0;
    let mut previous: Option<f64> = None;
    let mut seen: BTreeMap<String, usize> = BTreeMap::new();
    for ((contest_id, key), _) in &ordered {
        *seen.entry(key.clone()).or_default() += 1;
        let _ = contest_id;
    }
    for (position, ((contest_id, key), mut entry)) in ordered.into_iter().enumerate() {
        if previous_contest != Some(contest_id) {
            previous_contest = Some(contest_id);
            rank = 1;
        } else if previous != Some(entry.score) {
            rank = position as i64 + 1;
        }
        previous = Some(entry.score);
        let final_rank = entry.rank.take().unwrap_or(rank);
        let id = if seen.get(&key).copied().unwrap_or(0) > 1 {
            format!("{}{}{}", key, '\u{1f}', contest_id)
        } else {
            key
        };
        out.insert(
            id,
            TeamEntry {
                contest_id: entry.contest_id,
                contest: entry.contest,
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
pub fn is_hidden(scope: &ContestScope, user: &str, team: Option<&str>) -> bool {
    scope.hides(TargetKind::User, user)
        || team.is_some_and(|team| scope.hides(TargetKind::Team, team))
}

/// Adds this task score to the user's row in one contest; a score override replaces the
/// aggregate of that contest only, and the same user in another contest keeps its row.
pub fn record_row(
    rows: &mut BTreeMap<(i32, String), BoardRow>,
    scope: &ContestScope,
    contest_id: i32,
    contest: &str,
    user: &str,
    team: Option<&str>,
    value: f64,
) {
    let override_score = scored_override(scope, user, team);
    let row = rows
        .entry((contest_id, user.to_string()))
        .or_insert_with(|| BoardRow {
            key: user.to_string(),
            contest_id,
            contest: contest.to_string(),
            name: renamed_override(scope, user, team).map(str::to_string),
            rank: pinned_override(scope, user, team),
            score: override_score.unwrap_or(0.0),
        });
    if override_score.is_none() && value > 0.0 {
        row.score += value;
    }
}

/// Adds the guests of each contest, orders within each contest, and gives each row its
/// rank; a pin replaces it. Ranks are per contest: a user in two contests has one rank
/// in each, not one rank on the union.
pub fn rank_rows(
    mut rows: BTreeMap<(i32, String), BoardRow>,
    overrides: &Overrides,
) -> Vec<BoardRow> {
    let contests: Vec<i32> = rows.keys().map(|(contest, _)| *contest).collect();
    let mut contest_ids = contests;
    contest_ids.sort_unstable();
    contest_ids.dedup();
    for contest_id in contest_ids {
        add_guest_rows(&mut rows, overrides, contest_id);
    }
    let mut ordered: Vec<BoardRow> = rows.into_values().collect();
    ordered.sort_by(|left, right| {
        left.contest_id
            .cmp(&right.contest_id)
            .then_with(|| {
                right
                    .score
                    .partial_cmp(&left.score)
                    .unwrap_or(Ordering::Equal)
            })
            .then_with(|| left.key.cmp(&right.key))
    });
    let mut previous_contest = None;
    let mut rank = 0;
    let mut previous = None;
    for (position, row) in ordered.iter_mut().enumerate() {
        if previous_contest != Some(row.contest_id) {
            previous_contest = Some(row.contest_id);
            rank = 1;
        } else if previous != Some(row.score) {
            rank = position as i64 + 1;
        }
        if row.rank.is_none() {
            row.rank = Some(rank);
        }
        previous = Some(row.score);
    }
    ordered
}

/// A user override wins over their team's, so a team rule never masks an individual.
fn renamed_override<'a>(
    scope: &'a ContestScope,
    user: &str,
    team: Option<&str>,
) -> Option<&'a str> {
    scope
        .renamed(TargetKind::User, user)
        .or_else(|| team.and_then(|team| scope.renamed(TargetKind::Team, team)))
}

fn scored_override(scope: &ContestScope, user: &str, team: Option<&str>) -> Option<f64> {
    scope
        .scored(TargetKind::User, user)
        .or_else(|| team.and_then(|team| scope.scored(TargetKind::Team, team)))
}

fn pinned_override(scope: &ContestScope, user: &str, team: Option<&str>) -> Option<i64> {
    scope
        .pinned(TargetKind::User, user)
        .or_else(|| team.and_then(|team| scope.pinned(TargetKind::Team, team)))
}

/// A guest is a row with no participation, ranked at its override score or zero.
fn add_guest_rows(
    rows: &mut BTreeMap<(i32, String), BoardRow>,
    overrides: &Overrides,
    contest_id: i32,
) {
    let scope = overrides.scope(contest_id);
    for guest in scope.guests() {
        if scope.hides(guest.kind, &guest.key) {
            continue;
        }
        rows.entry((contest_id, guest.key.clone()))
            .or_insert_with(|| BoardRow {
                key: guest.key.clone(),
                contest_id,
                contest: String::new(),
                name: Some(guest.name.clone()),
                score: scope.scored(guest.kind, &guest.key).unwrap_or(0.0),
                rank: scope.pinned(guest.kind, &guest.key),
            });
    }
}
