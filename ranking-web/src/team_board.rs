use std::cmp::Ordering;
use std::collections::BTreeMap;

use serde::Serialize;

use crate::board::{BoardRow, UserNames};
use crate::overrides::{Overrides, TargetKind};

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
