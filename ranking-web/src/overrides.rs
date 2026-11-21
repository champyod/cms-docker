use serde::Serialize;
use sqlx::postgres::PgPool;

use std::collections::{HashMap, HashSet};

use crate::store::StoreError;

use serde_json::Value;

/// The wire spelling of a target kind in ranking_overrides.target_kind.
pub(crate) const TARGET_USER: &str = "user";
const TARGET_TEAM: &str = "team";
/// The whole-board target: its key is always `*`, and only hide/freeze apply to it.
const TARGET_RANKING: &str = "ranking";
/// A task column: its key is the encoded task name the projection carries, and only
/// `hide` applies to it.
const TARGET_TASK: &str = "task";
/// A whole contest: its key is the encoded contest name the projection files each task
/// under, and only `hide` applies to it. WHY its own kind rather than a `task` key: hiding
/// a contest drops the contest and every task filed under it, so the target is the group
/// the page draws and sums, not one column inside it.
///
/// WHY visible to the crate: `ranking_config` spells the target that *shows* a contest's content
/// with this same wire name, so the one string must be the one place the spelling lives or a
/// rename of it would silently stop matching between the two surfaces.
pub(crate) const TARGET_CONTEST: &str = "contest";

/// The six actions the panel may write, taken from dictionaries/en.json.
/// WHY freeze is here: the panel has always offered it (OVERRIDE_ACTIONS, and
/// actionFreeze in en.json), and before this it fell through the fold's `_ => false`
/// arm — a success toast, an audit row, and no change to the board.
pub(crate) const ACTION_HIDE: &str = "hide";
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
    /// The task and contest hides, kept together because /tasks/ and /contests/ fold exactly
    /// these out of one small query while the board folds them out of the whole override set,
    /// and both must apply the same predicate. WHY not a `Sides`: a task or a contest is
    /// neither a user nor a team, so neither has a half of the board to belong to.
    hidden_targets: HiddenTargets,
}

/// The hides that drop a whole entity from /tasks/ or /contests/ rather than a board row.
/// WHY its own type: the board fold builds it from every override row, and the entity list
/// builds it from one small query, so the predicate that reads it lives in exactly one place.
#[derive(Debug, Default, Clone)]
pub struct HiddenTargets {
    /// The `(contest, task)` pairs a composite `hide` drops. WHY the pair and not the bare
    /// name: a task may sit in many contests, so a per-contest hide needs the contest in the
    /// key.
    hidden_task_pairs: HashSet<(String, String)>,
    /// Task keys a pre-composite bare `hide` names with no contest: the bare spelling hides
    /// the task in every contest it appears in, so an old row keeps working without a
    /// migration.
    hidden_tasks_any_contest: HashSet<String>,
    /// The contest keys a `hide` on the contest target drops. Read by the entity list to drop
    /// the contest and every task filed under it, and by the ledger to keep the total honest
    /// when a whole contest leaves the board.
    hidden_contests: HashSet<String>,
}

/// The projection's task side, as the reader already reads it: the `(contest, task)` pairs it
/// holds, the task keys it holds anywhere, every contest it holds, and which of those hold a
/// task. WHY the causes are read against this and not against a query of their own: a task
/// hide's key is the composite the picker writes, so whether it still names something is a
/// question about these rows alone.
#[derive(Debug, Default, Clone)]
pub struct TaskSnapshot {
    pairs: HashSet<(String, String)>,
    tasks: HashSet<String>,
    contests: HashSet<String>,
    contests_with_tasks: HashSet<String>,
}

impl TaskSnapshot {
    /// A task the projection holds, under the encoded contest key it files it by.
    /// WHY public: the ledger classification needs a snapshot fixture too, and an integration
    /// test builds one from the pairs it asserts on rather than from a database.
    pub fn add_task(&mut self, contest: &str, task: &str) {
        self.pairs.insert((contest.to_string(), task.to_string()));
        self.tasks.insert(task.to_string());
        self.contests.insert(contest.to_string());
        self.contests_with_tasks.insert(contest.to_string());
    }

    /// A contest the projection holds. The push writes the contest row even when it announces
    /// no task of it, which is the only trace a withheld task leaves behind.
    pub fn add_contest(&mut self, contest: &str) {
        self.contests.insert(contest.to_string());
    }

    /// Whether the projection holds a task of that key in a drawn contest.
    ///
    /// WHY this is the ledger's hide test: the modes the fold replays are exactly these tasks
    /// minus the hides, so a task the snapshot announces and the replay set lacks is one a hide
    /// dropped — whichever shape the hide took. Asking the override sets directly saw only the
    /// task-target shape, so a hidden contest's submissions counted as data faults.
    pub fn announces(&self, task: &str) -> bool {
        self.tasks.contains(task)
    }
}

/// The task hides that named no projected task row, split by the cause the snapshot explains.
///
/// WHY the split: the counter's job is to catch a hide that silently stopped applying because
/// its task was renamed, and a task the projection withholds raised that alarm forever without
/// anything having been renamed — a false alarm in the one counter that has to be believed.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct TaskHideCauses {
    withheld: usize,
    renamed: usize,
    unmatched: usize,
}

impl TaskHideCauses {
    /// The hides whose contest the projection holds with no task of it: the push announced the
    /// contest with an empty task set (its task had no active dataset), so the CMS knows the
    /// task and the projection withholds it. Nothing was renamed.
    pub fn withheld(&self) -> usize {
        self.withheld
    }

    /// The hides whose contest holds tasks but not the one the hide names: the key is stale,
    /// which is the rename (or removal) this counter exists to catch.
    pub fn renamed(&self) -> usize {
        self.renamed
    }

    /// The hides naming neither a contest nor, for a bare key, a task the projection holds:
    /// nothing in the snapshot explains the key.
    pub fn unmatched(&self) -> usize {
        self.unmatched
    }

    /// Every task hide that named no projected task row — the counter's meaning before the
    /// split. The three causes partition exactly this set, so the split separates a number
    /// rather than moving one.
    pub fn total(&self) -> usize {
        self.withheld + self.renamed + self.unmatched
    }
}

impl HiddenTargets {
    /// Whether a `hide` override drops the task, by the contest it is filed under and the key
    /// the board files it by. A pre-composite bare key matches in every contest, so an old row
    /// keeps its meaning.
    pub fn hides_task(&self, contest: &str, task: &str) -> bool {
        self.hidden_tasks_any_contest.contains(task)
            || self
                .hidden_task_pairs
                .contains(&(contest.to_string(), task.to_string()))
    }

    /// Whether a `hide` override drops the contest and every task filed under it.
    pub fn hides_contest(&self, contest: &str) -> bool {
        self.hidden_contests.contains(contest)
    }

    /// How many task hides name no projected task row, split by the cause the snapshot
    /// explains.
    ///
    /// A composite key is classified by its contest half: a contest that holds tasks but not
    /// the one the hide names is the stale key a rename leaves, a contest that holds no task at
    /// all is one whose tasks the projection withheld, and a contest the snapshot does not hold
    /// is a key that names nothing. A bare key carries no contest, so it is unknown exactly
    /// when the projection holds no task of that name anywhere.
    pub fn task_hide_causes(&self, snapshot: &TaskSnapshot) -> TaskHideCauses {
        let mut causes = TaskHideCauses::default();
        for pair in &self.hidden_task_pairs {
            let (contest, _task) = pair;
            if snapshot.pairs.contains(pair) {
                continue;
            }
            if snapshot.contests_with_tasks.contains(contest) {
                causes.renamed += 1;
            } else if snapshot.contests.contains(contest) {
                causes.withheld += 1;
            } else {
                causes.unmatched += 1;
            }
        }
        for task in &self.hidden_tasks_any_contest {
            if !snapshot.tasks.contains(task) {
                causes.unmatched += 1;
            }
        }
        causes
    }

    /// The task target: its key is a composite `"<encodedContestKey>/<encodedTaskName>"`, and
    /// since the encoder turns every character outside `[A-Za-z0-9]` into `_<hex>` neither half
    /// can hold a `/`, so `split_once` is an exact parse. A key with no `/` is the pre-composite
    /// spelling and hides the task in every contest.
    fn insert_task_hide(&mut self, key: &str) {
        match key.split_once('/') {
            Some((contest, task)) => {
                self.hidden_task_pairs
                    .insert((contest.to_string(), task.to_string()));
            }
            None => {
                self.hidden_tasks_any_contest.insert(key.to_string());
            }
        }
    }

    /// The contest target: `hide` drops the contest and every task filed under it.
    fn insert_contest_hide(&mut self, key: &str) {
        self.hidden_contests.insert(key.to_string());
    }
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

    /// Whether a `hide` override drops the task, by the contest it is filed under and the
    /// key the board files it by. Read by the entity list and the ledger assembly, which is
    /// what makes one hide drop the column and its scores rather than only one of the two.
    pub fn hides_task(&self, contest: &str, task: &str) -> bool {
        self.hidden_targets.hides_task(contest, task)
    }

    /// Whether a `hide` override drops the contest and every task filed under it. Read by
    /// the entity list to drop the contest and its tasks, and by the ledger to take the
    /// contest's scores and history with it.
    pub fn hides_contest(&self, contest: &str) -> bool {
        self.hidden_targets.hides_contest(contest)
    }

    /// The task hides that name no projected task row, split by cause. Read by the store, the
    /// only place that holds both the hides and the snapshot they are classified against.
    pub fn task_hide_causes(&self, snapshot: &TaskSnapshot) -> TaskHideCauses {
        self.hidden_targets.task_hide_causes(snapshot)
    }

    fn fold_row(&mut self, row: &OverrideRow) {
        if row.target_kind == TARGET_RANKING {
            self.fold_board_row(row);
            return;
        }
        if row.target_kind == TARGET_TASK {
            self.fold_task_row(row);
            return;
        }
        if row.target_kind == TARGET_CONTEST {
            self.fold_contest_row(row);
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

    /// The task target: `hide` drops the column. Its key is the composite the encoder spells,
    /// a bare key is the pre-composite spelling, and `HiddenTargets` is the one place that
    /// parses the two apart. Every other action names a user, a team or the whole board, so on
    /// `task` it is refused and counted.
    fn fold_task_row(&mut self, row: &OverrideRow) {
        let folded = match row.action.as_str() {
            ACTION_HIDE => {
                self.hidden_targets.insert_task_hide(&row.target_key);
                true
            }
            _ => false,
        };
        if !folded {
            self.skipped += 1;
        }
    }

    /// The contest target: `hide` drops the contest and every task filed under it. Every
    /// other action names a user, a team, a task or the whole board, so on `contest` it is
    /// refused and counted.
    fn fold_contest_row(&mut self, row: &OverrideRow) {
        let folded = match row.action.as_str() {
            ACTION_HIDE => {
                self.hidden_targets.insert_contest_hide(&row.target_key);
                true
            }
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

/// The active override rows that can reach the board the config shows, as the raw log.
///
/// WHY the scope is the shown set: an override only applies to a contest the board draws, so the
/// read is bounded by exactly those contests. There is no "no scope means everything" arm any
/// more — that arm let an instance with no contest apply rows filed under contests it did not
/// serve, which is how six hides filed under contests 3 and 7 kept applying when the reader
/// moved to 9.
pub async fn load_overrides(
    pool: &PgPool,
    contest_ids: &[i32],
) -> Result<Vec<Override>, StoreError> {
    let rows = sqlx::query_as::<_, Override>(
        "SELECT target_kind, target_key, action, payload->>'value' AS value \
         FROM ranking_overrides WHERE active AND contest_id = ANY($1) ORDER BY id",
    )
    .bind(contest_ids)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// One `(target_kind, target_key)` pair the small hidden-targets query returns.
#[derive(sqlx::FromRow)]
struct HiddenKindKey {
    target_kind: String,
    target_key: String,
}

/// The hides that drop a whole entity from an entity list, read on their own. WHY not the full
/// fold: /tasks/ and /contests/ poll this on every request and need no user, team or score
/// override, and a `ranking_hidden` tombstone is always a user, so it can never drop a task or
/// a contest. WHY one query for both kinds: a hidden contest drops the contest and every task
/// filed under it, and a hidden task drops one column, so both lists must read the same rows or
/// the two lists could disagree about the same hide.
pub async fn load_hidden_tasks(
    pool: &PgPool,
    contest_ids: &[i32],
) -> Result<HiddenTargets, StoreError> {
    let rows = sqlx::query_as::<_, HiddenKindKey>(
        "SELECT target_kind, target_key FROM ranking_overrides \
         WHERE active AND action = $1 AND target_kind IN ($2, $3) \
         AND contest_id = ANY($4)",
    )
    .bind(ACTION_HIDE)
    .bind(TARGET_TASK)
    .bind(TARGET_CONTEST)
    .bind(contest_ids)
    .fetch_all(pool)
    .await?;
    let mut hidden = HiddenTargets::default();
    for row in rows {
        if row.target_kind == TARGET_TASK {
            hidden.insert_task_hide(&row.target_key);
        } else {
            hidden.insert_contest_hide(&row.target_key);
        }
    }
    Ok(hidden)
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

    fn override_row(kind: &str, key: &str, action: &str) -> OverrideRow {
        OverrideRow {
            target_kind: kind.to_string(),
            target_key: key.to_string(),
            action: action.to_string(),
            payload: None,
        }
    }

    /// A task hide drops the whole board column, so it folds like a hide instead of
    /// being counted as an unreadable target the way an unknown kind is. The key is the
    /// composite contest/task spelling the picker writes.
    #[test]
    fn a_task_hide_row_hides_the_task() {
        let overrides = Overrides::fold(&[
            override_row("task", "c0/t0", "hide"),
            override_row("task", "c1/t1", "hide"),
        ]);

        assert!(
            overrides.hides_task("c0", "t0"),
            "the hide drops the named task in its contest"
        );
        assert!(
            overrides.hides_task("c1", "t1"),
            "each hide names its own task"
        );
        assert!(
            !overrides.hides_task("c0", "t2"),
            "a task with no override stays"
        );
        assert_eq!(overrides.skipped(), 0, "a task hide is not a malformed row");
    }

    /// The composite key buys a per-contest hide: a task of the same name in another
    /// contest is untouched, which a bare name could not express.
    #[test]
    fn a_composite_task_hide_names_only_its_own_contest() {
        let overrides = Overrides::fold(&[override_row("task", "c0/t0", "hide")]);

        assert!(overrides.hides_task("c0", "t0"));
        assert!(
            !overrides.hides_task("c1", "t0"),
            "the same task name in another contest stays"
        );
    }

    /// Backwards compatibility: a pre-composite bare key has no slash, so it hides the
    /// task wherever it appears rather than being dropped as an unreadable row.
    #[test]
    fn a_bare_task_key_hides_in_every_contest() {
        let overrides = Overrides::fold(&[override_row("task", "t0", "hide")]);

        assert!(overrides.hides_task("c0", "t0"), "the bare key hides in c0");
        assert!(
            overrides.hides_task("c1", "t0"),
            "and in every other contest too"
        );
        assert!(
            !overrides.hides_task("c0", "t1"),
            "it names only the task it spells"
        );
        assert_eq!(overrides.skipped(), 0, "the legacy spelling is understood");
    }

    /// A task is a column and not a row, so every verb but hide names something a task
    /// cannot have: the row is refused and counted rather than folded into the board.
    #[test]
    fn a_non_hide_action_on_a_task_is_refused() {
        let overrides = Overrides::fold(&[override_row("task", "c0/t0", "rename")]);

        assert!(
            !overrides.hides_task("c0", "t0"),
            "a refused row hides nothing"
        );
        assert_eq!(overrides.skipped(), 1, "the refusal is reported");
    }

    /// A contest hide is the group: the contest and every task filed under it leave the
    /// board, while a contest with no row stays.
    #[test]
    fn a_contest_hide_hides_the_contest() {
        let overrides = Overrides::fold(&[override_row("contest", "c0", "hide")]);

        assert!(
            overrides.hides_contest("c0"),
            "the hide drops the named contest"
        );
        assert!(
            !overrides.hides_contest("c1"),
            "a contest with no override stays"
        );
        assert_eq!(
            overrides.skipped(),
            0,
            "a contest hide is not a malformed row"
        );
    }

    /// A contest is a group and not a row, so every verb but hide names something a
    /// contest cannot have: the row is refused and counted rather than folded.
    #[test]
    fn a_non_hide_action_on_a_contest_is_refused() {
        let overrides = Overrides::fold(&[override_row("contest", "c0", "rename")]);

        assert!(
            !overrides.hides_contest("c0"),
            "a refused row hides nothing"
        );
        assert_eq!(overrides.skipped(), 1, "the refusal is reported");
    }

    /// The task and contest sets are their own, so neither key reaches a user or a team
    /// that happens to carry the same key.
    #[test]
    fn a_task_or_contest_hide_is_not_a_user_or_team_hide() {
        let overrides = Overrides::fold(&[
            override_row("task", "c0/shared", "hide"),
            override_row("contest", "shared", "hide"),
        ]);

        assert!(overrides.hides_task("c0", "shared"));
        assert!(overrides.hides_contest("shared"));
        assert!(!overrides.hides(TargetKind::User, "shared"));
        assert!(!overrides.hides(TargetKind::Team, "shared"));
    }

    /// The three causes, one fixture each: a contest the projection holds with no task of it
    /// (the withheld task the CMS knows), a contest that holds tasks but not the named one (the
    /// stale key a rename leaves), and a key the snapshot does not name at all. WHY a snapshot
    /// fixture and not a database: the classification is a property of the rows the reader
    /// already holds.
    #[test]
    fn a_hide_that_names_no_task_row_is_classified_by_its_cause() {
        let overrides = Overrides::fold(&[
            override_row("task", "c0/gone", "hide"),
            override_row("task", "c1/stale", "hide"),
            override_row("task", "c9/absent", "hide"),
        ]);
        let mut snapshot = TaskSnapshot::default();
        // c0 was announced with no task of it: its task is withheld, not renamed.
        snapshot.add_contest("c0");
        // c1 is live and holds t0: a hide naming another task is the stale key.
        snapshot.add_task("c1", "t0");
        // c9 is not in the snapshot at all.

        let causes = overrides.task_hide_causes(&snapshot);

        assert_eq!(causes.withheld(), 1, "c0 holds no task: withheld");
        assert_eq!(causes.renamed(), 1, "c1 holds t0 and not stale: renamed");
        assert_eq!(causes.unmatched(), 1, "c9 names nothing the snapshot holds");
        assert_eq!(
            causes.total(),
            3,
            "the causes partition every hide that named no task row"
        );
    }

    /// A hide the projection can satisfy applies, so it is not a cause; and a bare key, which
    /// carries no contest for a withheld task set to be attributed to, is unmatched exactly
    /// when the projection holds no task of that name anywhere.
    #[test]
    fn a_hide_the_projection_can_satisfy_is_not_a_cause() {
        let overrides = Overrides::fold(&[
            override_row("task", "c1/t0", "hide"),
            override_row("task", "t0", "hide"),
            override_row("task", "nobody", "hide"),
        ]);
        let mut snapshot = TaskSnapshot::default();
        snapshot.add_task("c1", "t0");

        let causes = overrides.task_hide_causes(&snapshot);

        assert_eq!(causes.total(), 1, "the two hides that name t0 apply");
        assert_eq!(
            causes.unmatched(),
            1,
            "the bare key with no task of that name is the one that names nothing"
        );
    }
}
