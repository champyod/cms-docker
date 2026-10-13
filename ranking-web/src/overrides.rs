use serde::Serialize;
use sqlx::postgres::PgPool;

use std::collections::{HashMap, HashSet};

use crate::store::StoreError;

use serde_json::Value;

/// The wire spelling of a target kind in ranking_overrides.target_kind.
const TARGET_USER: &str = "user";
const TARGET_TEAM: &str = "team";
/// The whole-board target: its key is always `*`, and only hide/freeze apply to it.
const TARGET_RANKING: &str = "ranking";

/// The six actions the panel may write, taken from dictionaries/en.json.
/// WHY freeze is here: the panel has always offered it (OVERRIDE_ACTIONS, and
/// actionFreeze in en.json), and before this it fell through the fold's `_ => false`
/// arm — a success toast, an audit row, and no change to the board.
const ACTION_HIDE: &str = "hide";
const ACTION_GUEST: &str = "guest";
const ACTION_PIN: &str = "pin";
const ACTION_RENAME: &str = "rename";
const ACTION_SCORE: &str = "score";
const ACTION_FREEZE: &str = "freeze";

/// The key of an override's single value inside payload.
const PAYLOAD_VALUE: &str = "value";

/// Which half of the board a target key names.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TargetKind {
    User,
    Team,
}

impl TargetKind {
    pub fn from_wire(raw: &str) -> Option<Self> {
        match raw {
            TARGET_USER => Some(Self::User),
            TARGET_TEAM => Some(Self::Team),
            _ => None,
        }
    }
}

/// A row the panel adds that has no participation behind it, ranked at zero.
#[derive(Debug, Clone, PartialEq)]
pub struct GuestRow {
    pub kind: TargetKind,
    pub key: String,
    pub name: String,
}

/// One ranking_overrides row as the store reads it.
#[derive(Debug, Clone)]
pub struct OverrideRow {
    pub target_kind: String,
    pub target_key: String,
    pub action: String,
    pub payload: Option<Value>,
}

/// The user-keyed and team-keyed half of one action, kept together.
#[derive(Debug, Default, Clone)]
struct Sides<T> {
    users: T,
    teams: T,
}

impl<T> Sides<T> {
    fn get(&self, kind: TargetKind) -> &T {
        match kind {
            TargetKind::User => &self.users,
            TargetKind::Team => &self.teams,
        }
    }

    fn get_mut(&mut self, kind: TargetKind) -> &mut T {
        match kind {
            TargetKind::User => &mut self.users,
            TargetKind::Team => &mut self.teams,
        }
    }
}

/// The active overrides, folded once so the one pass looks each target up in O(1).
#[derive(Debug, Default, Clone)]
pub struct Overrides {
    hidden: Sides<HashSet<String>>,
    renamed: Sides<HashMap<String, String>>,
    scored: Sides<HashMap<String, f64>>,
    pinned: Sides<HashMap<String, i64>>,
    guests: Vec<GuestRow>,
    skipped: usize,
    /// The latest freeze cutoff seen, in projection time. WHY latest and not Sides:
    /// a freeze is a property of the scoreboard, not of a user or a team, so unlike
    /// every other action it has nothing to key on. Later rows win by position, which
    /// is how the table already resolves one action overriding another.
    frozen_at: Option<i64>,
    /// A `hide` on the whole-board target. The assembly reads it to blank the board.
    board_hidden: bool,
}

impl Overrides {
    /// Drops an unreadable row and counts it rather than refusing: one typo must not black out the board.
    pub fn fold(rows: &[OverrideRow]) -> Self {
        let mut overrides = Self::default();
        for row in rows {
            overrides.fold_row(row);
        }
        overrides
    }

    pub fn guests(&self) -> &[GuestRow] {
        &self.guests
    }

    pub fn skipped(&self) -> usize {
        self.skipped
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

    /// The cutoff from a `freeze` override, or None when the board is not frozen.
    /// Read by the replay so subchanges after the cutoff never reach the ledger.
    pub fn frozen_at(&self) -> Option<i64> {
        self.frozen_at
    }

    /// Whether a whole-board `hide` override is active. Read by the assembly to blank
    /// the board and its scores, the way the retired client's is_board_hidden did.
    pub fn board_hidden(&self) -> bool {
        self.board_hidden
    }

    fn fold_row(&mut self, row: &OverrideRow) {
        if row.target_kind == TARGET_RANKING {
            self.fold_board_row(row);
            return;
        }
        let Some(kind) = TargetKind::from_wire(&row.target_kind) else {
            self.skipped += 1;
            return;
        };
        let key = row.target_key.as_str();
        let folded = match row.action.as_str() {
            ACTION_HIDE => {
                self.hidden.get_mut(kind).insert(key.to_string());
                true
            }
            ACTION_GUEST => self.fold_guest(kind, key, &row.payload),
            ACTION_RENAME => self.fold_rename(kind, key, &row.payload),
            ACTION_PIN => self.fold_pin(kind, key, &row.payload),
            ACTION_SCORE => self.fold_score(kind, key, &row.payload),
            ACTION_FREEZE => self.fold_freeze(&row.payload),
            _ => false,
        };
        if !folded {
            self.skipped += 1;
        }
    }

    /// The whole-board target: `hide` blanks the board, `freeze` holds it at a cutoff.
    /// Every other action names a user or a team, so on `ranking` it is refused and counted.
    fn fold_board_row(&mut self, row: &OverrideRow) {
        let folded = match row.action.as_str() {
            ACTION_HIDE => {
                self.board_hidden = true;
                true
            }
            ACTION_FREEZE => self.fold_freeze(&row.payload),
            _ => false,
        };
        if !folded {
            self.skipped += 1;
        }
    }

    fn fold_guest(&mut self, kind: TargetKind, key: &str, payload: &Option<Value>) -> bool {
        let Some(name) = payload_name(payload) else {
            return false;
        };
        self.guests.push(GuestRow {
            kind,
            key: key.to_string(),
            name,
        });
        true
    }

    fn fold_rename(&mut self, kind: TargetKind, key: &str, payload: &Option<Value>) -> bool {
        let Some(name) = payload_name(payload) else {
            return false;
        };
        self.renamed.get_mut(kind).insert(key.to_string(), name);
        true
    }

    fn fold_pin(&mut self, kind: TargetKind, key: &str, payload: &Option<Value>) -> bool {
        let Some(rank) = payload_name(payload).and_then(|value| value.parse::<i64>().ok()) else {
            return false;
        };
        self.pinned.get_mut(kind).insert(key.to_string(), rank);
        true
    }

    fn fold_score(&mut self, kind: TargetKind, key: &str, payload: &Option<Value>) -> bool {
        let Some(score) = payload_name(payload).and_then(|value| value.parse::<f64>().ok()) else {
            return false;
        };
        if !score.is_finite() {
            return false;
        }
        self.scored.get_mut(kind).insert(key.to_string(), score);
        true
    }

    /// A freeze carries the projection-time cutoff to hold the board at. Parsed as an
    /// integer because projection time is whole seconds; a fractional or malformed
    /// value is refused so a typo is reported in `skipped` rather than truncating the
    /// scoreboard to an unintended instant.
    fn fold_freeze(&mut self, payload: &Option<Value>) -> bool {
        let Some(cutoff) = payload_name(payload).and_then(|value| value.parse::<i64>().ok()) else {
            return false;
        };
        self.frozen_at = Some(cutoff);
        true
    }
}

/// The non-empty "value" string inside a payload, or None when it is missing or blank.
fn payload_name(payload: &Option<Value>) -> Option<String> {
    payload
        .as_ref()?
        .get(PAYLOAD_VALUE)?
        .as_str()
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, sqlx::FromRow)]
pub struct Override {
    pub target_kind: String,
    pub target_key: String,
    pub action: String,
    pub value: Option<String>,
}

pub async fn load_overrides(
    pool: &PgPool,
    contest_id: Option<i64>,
) -> Result<Vec<Override>, StoreError> {
    let rows = sqlx::query_as::<_, Override>(
        "SELECT target_kind, target_key, action, payload->>'value' AS value \
         FROM ranking_overrides WHERE active AND ($1::bigint IS NULL OR contest_id = $1) ORDER BY id",
    )
    .bind(contest_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn row(kind: &str, key: &str, action: &str, value: Option<&str>) -> Override {
        Override {
            target_kind: kind.to_string(),
            target_key: key.to_string(),
            action: action.to_string(),
            value: value.map(str::to_string),
        }
    }

    #[test]
    fn later_rows_win_by_position() {
        let rows = [
            row("user", "alice", "hide", None),
            row("user", "alice", "rename", Some("Alicia")),
        ];
        let latest: BTreeMap<(String, String), &Override> = rows
            .iter()
            .map(|row| ((row.target_kind.clone(), row.target_key.clone()), row))
            .collect();
        assert_eq!(
            latest.get(&("user".to_string(), "alice".to_string())),
            Some(&&rows[1])
        );
    }

    #[test]
    fn unknown_verbs_survive_the_serve() {
        let kept = serde_json::to_string(&row("user", "bob", "frob", None)).unwrap();
        assert!(kept.contains("\"action\":\"frob\""));
    }
}
