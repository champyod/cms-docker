use std::collections::{HashMap, HashSet};

use crate::overrides::{GuestRow, TargetKind};

/// The user-keyed and team-keyed half of one action, kept together.
#[derive(Debug, Default, Clone)]
pub(crate) struct Sides<T> {
    users: T,
    teams: T,
}

impl<T> Sides<T> {
    pub(crate) fn get(&self, kind: TargetKind) -> &T {
        match kind {
            TargetKind::User => &self.users,
            TargetKind::Team => &self.teams,
        }
    }

    pub(crate) fn get_mut(&mut self, kind: TargetKind) -> &mut T {
        match kind {
            TargetKind::User => &mut self.users,
            TargetKind::Team => &mut self.teams,
        }
    }
}

/// The user/team half of the board for one contest. A board row is a participation in
/// one contest, so every action that names a user or a team must be looked up inside the
/// contest that row belongs to; the global sets below remain for the entity and task
/// surfaces, which are not per-contest.
#[derive(Debug, Default, Clone)]
pub struct ContestScope {
    pub(crate) hidden: Sides<HashSet<String>>,
    pub(crate) renamed: Sides<HashMap<String, String>>,
    pub(crate) scored: Sides<HashMap<String, f64>>,
    pub(crate) pinned: Sides<HashMap<String, i64>>,
    pub(crate) guests: Vec<GuestRow>,
    pub(crate) frozen_at: Option<i64>,
}

impl ContestScope {
    /// Whether this contest carries no folded action at all.
    pub fn is_empty(&self) -> bool {
        self.hidden.users.is_empty()
            && self.hidden.teams.is_empty()
            && self.renamed.users.is_empty()
            && self.renamed.teams.is_empty()
            && self.scored.users.is_empty()
            && self.scored.teams.is_empty()
            && self.pinned.users.is_empty()
            && self.pinned.teams.is_empty()
            && self.guests.is_empty()
            && self.frozen_at.is_none()
    }

    pub fn hides(&self, kind: TargetKind, key: &str) -> bool {
        self.hidden.get(kind).contains(key)
    }

    pub fn renamed(&self, kind: TargetKind, key: &str) -> Option<&str> {
        self.renamed.get(kind).get(key).map(String::as_str)
    }

    pub fn scored(&self, kind: TargetKind, key: &str) -> Option<f64> {
        self.scored.get(kind).get(key).copied()
    }

    pub fn pinned(&self, kind: TargetKind, key: &str) -> Option<i64> {
        self.pinned.get(kind).get(key).copied()
    }

    pub fn guests(&self) -> &[GuestRow] {
        &self.guests
    }

    pub fn frozen_at(&self) -> Option<i64> {
        self.frozen_at
    }
}
