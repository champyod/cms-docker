use std::cmp::Ordering;
use std::collections::BTreeMap;

use crate::overrides::{Overrides, TargetKind};

/// One board row: a user, with the name, aggregate score and rank an override may set.
#[derive(Debug, Clone, PartialEq)]
pub struct BoardRow {
    pub key: String,
    pub name: Option<String>,
    pub score: f64,
    pub rank: Option<i64>,
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
