use std::collections::{BTreeMap, HashSet};

use serde::Serialize;
use sqlx::postgres::PgPool;

use crate::board::{self, BoardEntry, TeamEntry, UserNames};
use crate::overrides::{OverrideRow, Overrides, ACTION_HIDE, TARGET_CONTEST, TARGET_USER};
use crate::scoring::{
    self, parse_extra, Ledger, ScoreError, ScoreMode, Subchange, Submission, TaskMode,
};

mod admin;

pub use admin::{
    load_admin_permissions, load_admin_user, touch_last_login, AdminPermissions, AdminUser,
    RANKING_READ_PERMISSION,
};

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error(transparent)]
    Score(#[from] ScoreError),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error("no database is configured")]
    NoDatabase,
    /// A config row names a target this reader cannot draw.
    ///
    /// WHY a refusal and not a skip: the config is the board's whole answer for what it shows, so
    /// a declaration it cannot honour must fail where an operator can see it rather than let the
    /// board quietly draw something the operator did not name.
    #[error("ranking_config shows a {kind} target, which this reader cannot draw")]
    UnshowableConfigTarget { kind: String },
    /// A contest target whose key is not a contest id.
    #[error("ranking_config shows the contest \"{key}\", which is not an id")]
    BadContestKey { key: String },
}

/// The contests the board is told to show, read from `ranking_config`.
///
/// WHY it is not an `Option` with a classic default: the default this replaces was "the active
/// contest" whenever nothing else named one, and that silent pick is exactly how a board came to
/// draw another day's columns. An empty shown set is a real configuration — the board draws
/// nothing — and it is never replaced by a contest nobody chose.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct ShownSet {
    contest_ids: Vec<i32>,
}

impl ShownSet {
    /// A shown set the caller already knows.
    ///
    /// WHY it exists beside `load_shown_set`: the reader reads one from the database and a test
    /// builds one by hand, and both must be the same type or the scope would be spelled twice and
    /// could drift.
    pub fn new(contest_ids: Vec<i32>) -> Self {
        Self { contest_ids }
    }

    /// The contests to draw, deduplicated and in the order the config declared them.
    pub fn contest_ids(&self) -> &[i32] {
        &self.contest_ids
    }

    pub fn is_empty(&self) -> bool {
        self.contest_ids.is_empty()
    }

    /// The one contest the board shows, or None when it shows none or several.
    ///
    /// WHY None for several: the header announces a board's contest, and naming one of several
    /// would announce a contest the operator did not choose — the same silent pick, in the header.
    pub fn sole_contest(&self) -> Option<i32> {
        match self.contest_ids.as_slice() {
            [only] => Some(*only),
            _ => None,
        }
    }
}

#[derive(sqlx::FromRow)]
struct ConfigRow {
    target_kind: String,
    target_key: String,
}

/// What the board is told to show, from the one table that decides it.
///
/// WHY a malformed row is a refusal: a contest key that is not an id cannot be matched against
/// anything, and skipping it would draw a board smaller than the one the operator configured with
/// no sign that a declaration was dropped.
pub async fn load_shown_set(pool: &PgPool) -> Result<ShownSet, StoreError> {
    let rows = sqlx::query_as::<_, ConfigRow>(
        "SELECT target_kind, target_key FROM ranking_config WHERE active ORDER BY id",
    )
    .fetch_all(pool)
    .await?;
    let mut contest_ids: Vec<i32> = Vec::new();
    for row in rows {
        if row.target_kind != TARGET_CONTEST {
            return Err(StoreError::UnshowableConfigTarget {
                kind: row.target_kind,
            });
        }
        let contest_id =
            row.target_key
                .trim()
                .parse::<i32>()
                .map_err(|_| StoreError::BadContestKey {
                    key: row.target_key.clone(),
                })?;
        if !contest_ids.contains(&contest_id) {
            contest_ids.push(contest_id);
        }
    }
    Ok(ShownSet { contest_ids })
}

/// Everything the board endpoints derive from one projection read: the ledger, the
/// names, the teams and the overrides. Built once per data change and shared, so a
/// page load (board + teams + scores + history) does not replay the whole contest
/// four times.
pub struct Standings {
    pub ledger: Ledger,
    pub users: BTreeMap<String, UserNames>,
    pub team_names: BTreeMap<String, String>,
    pub overrides: Overrides,
}

/// Holds one built [`Standings`] and drops it on invalidation. The first reader to find
/// it empty rebuilds while the others wait on the lock, so the four endpoints a page
/// load hits cost one rebuild rather than one each.
#[derive(Clone, Default)]
pub struct StandingsCache {
    inner: std::sync::Arc<tokio::sync::Mutex<Option<std::sync::Arc<Standings>>>>,
}

impl StandingsCache {
    pub async fn invalidate(&self) {
        let mut guard = self.inner.lock().await;
        *guard = None;
    }

    pub async fn get_or_build<F, Fut>(
        &self,
        build: F,
    ) -> Result<std::sync::Arc<Standings>, StoreError>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<Standings, StoreError>>,
    {
        let mut guard = self.inner.lock().await;
        if let Some(cached) = guard.as_ref() {
            return Ok(cached.clone());
        }
        let built = std::sync::Arc::new(build().await?);
        *guard = Some(built.clone());
        Ok(built)
    }
}

pub async fn load_standings(pool: &PgPool) -> Result<Standings, StoreError> {
    let shown = load_shown_set(pool).await?;
    let users = load_users(pool).await?;
    let team_names = load_team_names(pool).await?;
    let overrides = load_overrides(pool, &shown).await?;
    let ledger = assemble_ledger(pool, &shown, &users, &overrides).await?;
    Ok(Standings {
        ledger,
        users,
        team_names,
        overrides,
    })
}

#[derive(sqlx::FromRow)]
struct TaskRow {
    key: String,
    contest: String,
    score_mode: String,
}

#[derive(sqlx::FromRow)]
struct SubmissionRow {
    key: String,
    user: String,
    task: String,
    time: i32,
}

#[derive(sqlx::FromRow)]
struct SubchangeRow {
    key: String,
    submission: String,
    time: i32,
    score: Option<f64>,
    token: Option<bool>,
    extra: Option<serde_json::Value>,
}

/// What the panel decides about how the scoreboard looks. Every field is optional
/// because the row may not exist yet, and the serving side falls back to the
/// vendored page defaults rather than inventing values.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Appearance {
    pub title: Option<String>,
    pub subtitle: Option<String>,
    pub organisation: Option<String>,
    pub logo_asset: Option<String>,
    pub favicon_asset: Option<String>,
    pub theme: Option<serde_json::Value>,
    pub columns: Option<serde_json::Value>,
    pub score_format: Option<serde_json::Value>,
    pub footer_text: Option<String>,
    pub credits_text: Option<String>,
    /// The panel's full credit list, when it has one.
    pub credits: Option<serde_json::Value>,
    /// The perspective tabs the panel enabled, in order. Normalised before it
    /// reaches the page; see crate::perspectives.
    pub perspectives: Option<serde_json::Value>,
    /// The explicit wording override per contest, keyed by the contest id it is for. An
    /// absent entry means the contest's own name and dates are the words.
    pub wording_overrides: Option<serde_json::Value>,
    pub access_mode: String,
}

/// The operator's words for one contest, when they wrote any.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Wording {
    pub title: Option<String>,
    pub subtitle: Option<String>,
}

impl Appearance {
    /// The scoreboard only learns whether to show the id column from this flag,
    /// so it is derived here rather than stored twice.
    pub fn show_id_column(&self) -> bool {
        self.columns
            .as_ref()
            .and_then(|columns| columns.get("show_id_column"))
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false)
    }

    /// Whether the panel starts the board anonymous, so a visitor sees no name until
    /// they turn it off. Names are hidden, not blanked: the rows stay where they are.
    pub fn anonymous(&self) -> bool {
        self.columns
            .as_ref()
            .and_then(|columns| columns.get("anonymous"))
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false)
    }

    /// The wording the operator wrote for the shown contest, or empty.
    ///
    /// WHY the override is keyed by contest id rather than held flat: the shown set names which
    /// contest's content the board draws, and a flat copy would keep describing the contest the
    /// board used to serve after the shown set moved — the bug this keying exists to rule out.
    pub fn wording_for(&self, contest_id: i32) -> Wording {
        let entry = self
            .wording_overrides
            .as_ref()
            .and_then(|overrides| overrides.get(contest_id.to_string()));
        let read = |field: &str| {
            entry
                .and_then(|value| value.get(field))
                .and_then(serde_json::Value::as_str)
                .map(str::to_string)
        };
        Wording {
            title: read("title"),
            subtitle: read("subtitle"),
        }
    }
}

/// The contest the board shows, as the projection holds it. `name` is the contest's
/// description, which is the human line the push files; `begin` and `end` are its
/// start and stop as unix seconds.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct RankingContest {
    pub name: String,
    pub begin: i32,
    pub end: i32,
}

/// The header of the board, with the operator's own words where they wrote any.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BoardHeader {
    pub title: String,
    pub subtitle: String,
}

impl BoardHeader {
    /// Resolves the words from the single contest the config shows: the explicit override first,
    /// the contest's own record otherwise.
    ///
    /// WHY the shown set decides and not a settings column: the board draws one contest only when
    /// the config names exactly one, so naming it anywhere else would be a second place the same
    /// fact could live and disagree. A board that shows none or several has no header to name —
    /// the page renders its own title there rather than announcing a contest nobody chose.
    ///
    /// WHY a missing contest row is not an error: a deployment whose push has not carried the id
    /// yet has no record to read, and inventing a heading there would be the same lie in a new
    /// place. The caller renders the default title instead.
    pub fn resolve(
        appearance: Option<&Appearance>,
        shown: &ShownSet,
        contest: Option<&RankingContest>,
    ) -> Option<Self> {
        let contest_id = shown.sole_contest()?;
        let wording = appearance.map_or_else(Wording::default, |row| row.wording_for(contest_id));
        let title = wording
            .title
            .as_deref()
            .and_then(non_blank)
            .or_else(|| contest.and_then(|row| non_blank(&row.name)))
            .unwrap_or_default();
        // The dates are built rather than borrowed, so the fallback resolves to a String
        // before the two branches meet.
        let subtitle = match wording.subtitle.as_deref().and_then(non_blank) {
            Some(written) => written.to_string(),
            None => contest.map(contest_dates).unwrap_or_default(),
        };
        Some(BoardHeader {
            title: title.to_string(),
            subtitle,
        })
    }
}

fn non_blank(value: &str) -> Option<&str> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then_some(trimmed)
}

/// The contest's own dates, so the header says which day it serves without anyone typing it.
fn contest_dates(contest: &RankingContest) -> String {
    let begin = utc_date(i64::from(contest.begin));
    let end = utc_date(i64::from(contest.end));
    if begin == end {
        begin
    } else {
        format!("{begin} – {end}")
    }
}

/// The UTC calendar date of a unix timestamp, as `YYYY-MM-DD`.
///
/// WHY this is written out rather than pulled from a date crate: the header needs one
/// stable, unambiguous rendering of an instant the projection already stores as seconds,
/// and a formatting dependency for that would be a whole calendar to keep current.
fn utc_date(seconds: i64) -> String {
    let days = seconds.div_euclid(86_400);
    // Days from 1970-01-01 to a civil date, by the shift-to-March form of the proleptic
    // Gregorian calendar: March is the year's first month, which puts the leap day at the
    // end of the year and makes the era's 400-year cycle exactly 146097 days long.
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}")
}

/// The contest the board shows, or None when the projection has no record for it yet.
pub async fn load_contest(
    pool: &PgPool,
    contest_id: i32,
) -> Result<Option<RankingContest>, StoreError> {
    let row = sqlx::query_as::<_, RankingContest>(
        "SELECT name, begin, \"end\" FROM ranking_contests WHERE contest_id = $1",
    )
    .bind(contest_id)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

pub async fn load_ledger(pool: &PgPool) -> Result<Ledger, StoreError> {
    let shown = load_shown_set(pool).await?;
    let users = load_users(pool).await?;
    let overrides = load_overrides(pool, &shown).await?;
    assemble_ledger(pool, &shown, &users, &overrides).await
}

/// The board the page draws: the ledger's override-shaped rows joined with the names
/// and team the projection holds, so a reader gets a name already renamed and a rank
/// already assigned instead of recomputing either.
pub async fn load_board(pool: &PgPool) -> Result<BTreeMap<String, BoardEntry>, StoreError> {
    let standings = load_standings(pool).await?;
    Ok(board::board_view(
        standings.ledger.board(),
        &standings.users,
    ))
}

/// The team board: the same rows grouped by team, with a team-level override applied to
/// the aggregate rather than to each member.
pub async fn load_team_board(pool: &PgPool) -> Result<BTreeMap<String, TeamEntry>, StoreError> {
    let standings = load_standings(pool).await?;
    Ok(board::team_board_view(
        standings.ledger.board(),
        &standings.users,
        &standings.team_names,
        &standings.overrides,
    ))
}

async fn assemble_ledger(
    pool: &PgPool,
    shown: &ShownSet,
    users: &BTreeMap<String, UserNames>,
    overrides: &Overrides,
) -> Result<Ledger, StoreError> {
    let (tasks, unknown_task_hides) = load_tasks(pool, shown, overrides).await?;
    let submissions = load_submissions(pool).await?;
    let subchanges = load_subchanges(pool).await?;
    let teams: BTreeMap<String, String> = users
        .iter()
        .filter_map(|(key, user)| user.team.clone().map(|team| (key.clone(), team)))
        .collect();
    let mut ledger = scoring::assemble_with(&tasks, &submissions, &subchanges, overrides, &teams)?;
    ledger.set_unknown_task_hides(unknown_task_hides);
    Ok(ledger)
}

pub async fn load_appearance(pool: &PgPool) -> Result<Option<Appearance>, StoreError> {
    let row = sqlx::query_as::<_, Appearance>(
        "SELECT title, subtitle, organisation, logo_asset, favicon_asset, theme, \
         columns, score_format, footer_text, credits_text, credits, perspectives, \
         wording_overrides, access_mode FROM ranking_settings WHERE id = 1",
    )
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

/// The task modes the ledger replays, and the number of task hides that named no task row.
/// WHY a hidden task or a task under a hidden contest is dropped here and not filtered out
/// later: the mode is what a submission resolves against, so without it the task's
/// submissions, scores and history never enter the ledger at all, and the hide reaches the
/// total the board prints rather than only the column the page draws.
///
/// WHY the read is scoped to the shown contests: a database holding more than one contest's
/// projected rows used to give the board *every* contest's columns, so a day-2 board drew day 1
/// and the only thing that removed the extra columns was a hide filed by hand. The board now
/// draws exactly the contests the config shows.
///
/// WHY the contest is selected with the key: a task hide is scoped to the contest it is filed
/// under, so the predicate needs both halves of the composite key the override carries.
async fn load_tasks(
    pool: &PgPool,
    shown: &ShownSet,
    overrides: &Overrides,
) -> Result<(Vec<TaskMode>, usize), StoreError> {
    let rows = sqlx::query_as::<_, TaskRow>(
        "SELECT key, contest, score_mode FROM ranking_tasks \
         WHERE contest_id = ANY($1) ORDER BY display_order, key",
    )
    .bind(shown.contest_ids())
    .fetch_all(pool)
    .await?;
    let known_pairs: HashSet<(String, String)> = rows
        .iter()
        .map(|row| (row.contest.clone(), row.key.clone()))
        .collect();
    let known_tasks: HashSet<String> = rows.iter().map(|row| row.key.clone()).collect();
    let unknown_task_hides = overrides.unknown_hidden_tasks(&known_pairs, &known_tasks);
    let modes = rows
        .into_iter()
        .filter(|row| {
            !overrides.hides_contest(&row.contest) && !overrides.hides_task(&row.contest, &row.key)
        })
        .map(|row| {
            let mode = ScoreMode::from_wire(&row.score_mode).ok_or_else(|| {
                ScoreError::UnknownScoreMode {
                    task: row.key.clone(),
                    mode: row.score_mode.clone(),
                }
            })?;
            Ok(TaskMode { key: row.key, mode })
        })
        .collect::<Result<Vec<_>, ScoreError>>()?;
    Ok((modes, unknown_task_hides))
}

async fn load_submissions(pool: &PgPool) -> Result<Vec<Submission>, StoreError> {
    let rows = sqlx::query_as::<_, SubmissionRow>(
        "SELECT key, \"user\", task, time FROM ranking_submissions ORDER BY time, key",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| Submission {
            key: row.key,
            user: row.user,
            task: row.task,
            time: i64::from(row.time),
        })
        .collect())
}

async fn load_subchanges(pool: &PgPool) -> Result<Vec<Subchange>, StoreError> {
    let rows = sqlx::query_as::<_, SubchangeRow>(
        "SELECT key, submission, time, score, token, extra FROM ranking_subchanges ORDER BY time, key",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| Subchange {
            key: row.key,
            submission: row.submission,
            time: i64::from(row.time),
            score: row.score,
            token: row.token,
            extra: row.extra.as_ref().and_then(parse_extra),
        })
        .collect())
}

#[derive(sqlx::FromRow)]
struct OverrideRowRecord {
    target_kind: String,
    target_key: String,
    action: String,
    payload: Option<serde_json::Value>,
}

/// The active overrides that reach the shown board, in one query, folded for the board assembly.
/// Only active rows apply — an ended override keeps its history in the table but not on the board.
///
/// WHY the scope is the shown set and no longer `IS NULL OR contest_id = $1`: the NULL arm made
/// "no scope configured" mean *every* override, so an instance with no contest applied rows filed
/// under contests it did not serve. The shown set bounds the override exactly, and an empty shown
/// set applies none.
///
/// WHY the hidden tombstones join here: a hidden participation must hide the same way a
/// `hide` override does, so the store folds the tombstones into the one override set
/// every board path already reads, and `board::is_hidden` governs the ledger and the
/// team view without a second filter.
///
/// WHY it is visible to the rest of the crate: the entity list reads the same fold, so a
/// task hide drops the board column and the ledger's scores from one interpretation of
/// the override rows rather than two.
pub(crate) async fn load_overrides(
    pool: &PgPool,
    shown: &ShownSet,
) -> Result<Overrides, StoreError> {
    let rows = sqlx::query_as::<_, OverrideRowRecord>(
        "SELECT target_kind, target_key, action, payload FROM ranking_overrides \
         WHERE active AND contest_id = ANY($1) ORDER BY id",
    )
    .bind(shown.contest_ids())
    .fetch_all(pool)
    .await?;
    let mut rows: Vec<OverrideRow> = rows
        .into_iter()
        .map(|row| OverrideRow {
            target_kind: row.target_kind,
            target_key: row.target_key,
            action: row.action,
            payload: row.payload,
        })
        .collect();
    rows.extend(
        load_hidden(pool, shown)
            .await?
            .into_iter()
            .map(hidden_as_hide_row),
    );
    Ok(Overrides::fold(&rows))
}

#[derive(sqlx::FromRow)]
struct TeamRow {
    key: String,
    name: String,
}

/// The team keys and their display names, so the team board names a team without a
/// query per row.
async fn load_team_names(pool: &PgPool) -> Result<BTreeMap<String, String>, StoreError> {
    let rows = sqlx::query_as::<_, TeamRow>("SELECT key, name FROM ranking_teams")
        .fetch_all(pool)
        .await?;
    Ok(rows.into_iter().map(|row| (row.key, row.name)).collect())
}

#[derive(sqlx::FromRow)]
struct UserRow {
    key: String,
    f_name: String,
    l_name: String,
    team: Option<String>,
}

/// Who each projected user is, so the board can name a row and a team override can
/// reach its members without a query per row.
async fn load_users(pool: &PgPool) -> Result<BTreeMap<String, UserNames>, StoreError> {
    // A participant added after the last proxy reinitialize has submissions but no
    // projection row, so the score payload would name a key with no user entity and
    // the page would fail to initialise. Take the union so every ranked user is
    // present; one with no projection row is named by its own key.
    let rows = sqlx::query_as::<_, UserRow>(
        "SELECT key, f_name, l_name, team FROM ranking_users \
         UNION SELECT s.\"user\", s.\"user\", '', NULL::text \
         FROM (SELECT DISTINCT \"user\" FROM ranking_submissions) AS s \
         WHERE NOT EXISTS (SELECT 1 FROM ranking_users AS u WHERE u.key = s.\"user\")",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| {
            (
                row.key,
                UserNames {
                    f_name: row.f_name,
                    l_name: row.l_name,
                    team: row.team,
                },
            )
        })
        .collect())
}

#[derive(sqlx::FromRow)]
struct HiddenRow {
    key: String,
}

/// A hidden participation behaves as the `hide` override it is, so the board's one hide
/// rule covers it and no filter site needs a second predicate. WHY it reuses the fold's
/// own spellings: the tombstone enters the one fold that already hides a user, so a
/// rename of either spelling cannot silently unhide everyone.
fn hidden_as_hide_row(key: String) -> OverrideRow {
    OverrideRow {
        target_kind: TARGET_USER.to_string(),
        target_key: key,
        action: ACTION_HIDE.to_string(),
        payload: None,
    }
}

/// The keys the panel hid in a shown contest. WHY the shown set bounds it: a tombstone is scoped
/// to the contest it was filed in, so one filed under a contest the board does not draw changes
/// nothing here, and an empty shown set hides nobody.
async fn load_hidden(pool: &PgPool, shown: &ShownSet) -> Result<Vec<String>, StoreError> {
    let rows = sqlx::query_as::<_, HiddenRow>(
        "SELECT key FROM ranking_hidden WHERE contest_id = ANY($1) ORDER BY key",
    )
    .bind(shown.contest_ids())
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|row| row.key).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    fn empty_standings() -> Standings {
        Standings {
            ledger: Ledger::default(),
            users: BTreeMap::new(),
            team_names: BTreeMap::new(),
            overrides: Overrides::default(),
        }
    }

    fn shown(contest_ids: &[i32]) -> ShownSet {
        ShownSet {
            contest_ids: contest_ids.to_vec(),
        }
    }

    /// The reason the cache exists: the four board endpoints a page load hits share one
    /// build, and a rebuild happens only after a projection change invalidates it.
    #[tokio::test]
    async fn the_cache_builds_once_until_invalidated() {
        let cache = StandingsCache::default();
        let builds = Arc::new(AtomicUsize::new(0));
        for _ in 0..5 {
            let counter = builds.clone();
            cache
                .get_or_build(|| async move {
                    counter.fetch_add(1, Ordering::SeqCst);
                    Ok(empty_standings())
                })
                .await
                .expect("the build succeeds");
        }
        assert_eq!(builds.load(Ordering::SeqCst), 1, "five reads, one build");

        cache.invalidate().await;
        let counter = builds.clone();
        cache
            .get_or_build(|| async move {
                counter.fetch_add(1, Ordering::SeqCst);
                Ok(empty_standings())
            })
            .await
            .expect("the rebuild succeeds");
        assert_eq!(
            builds.load(Ordering::SeqCst),
            2,
            "an invalidation costs one rebuild"
        );
    }

    /// A hidden participation must hide through the one hide rule the board already
    /// applies, so no board path needs a second filter for it.
    #[test]
    fn a_hidden_row_folds_into_the_hide_rule() {
        let overrides = Overrides::fold(&[hidden_as_hide_row("u0".to_string())]);
        assert!(
            board::is_hidden(&overrides, "u0", None),
            "the tombstoned key is hidden"
        );
        assert!(
            !board::is_hidden(&overrides, "u1", None),
            "a key with no tombstone stays"
        );
    }

    /// The header names the board's day only when the config names exactly one contest.
    #[test]
    fn the_header_needs_a_single_shown_contest() {
        let contest = RankingContest {
            name: "POSN Day 2".to_string(),
            begin: 1_792_108_800,
            end: 1_792_195_200,
        };
        assert!(
            BoardHeader::resolve(None, &shown(&[]), Some(&contest)).is_none(),
            "a board showing nothing has no header to name"
        );
        assert!(
            BoardHeader::resolve(None, &shown(&[9, 3]), Some(&contest)).is_none(),
            "a board showing several names none of them"
        );
        assert_eq!(
            BoardHeader::resolve(None, &shown(&[9]), Some(&contest))
                .expect("it resolves")
                .title,
            "POSN Day 2",
            "the one shown contest names the board"
        );
    }

    /// The rendering of an instant must be the calendar day a reader would name, including across
    /// a leap day and before the epoch.
    #[test]
    fn a_timestamp_renders_as_its_utc_calendar_day() {
        assert_eq!(utc_date(0), "1970-01-01");
        assert_eq!(utc_date(1_700_000_000), "2023-11-14");
        assert_eq!(utc_date(951_782_400), "2000-02-29", "a leap day");
        assert_eq!(utc_date(-1), "1969-12-31", "the day before the epoch");
    }

    /// A contest whose start and stop fall on one day names that day once.
    #[test]
    fn the_contest_dates_are_a_span_only_when_the_days_differ() {
        let one_day = RankingContest {
            name: "c".to_string(),
            begin: 951_782_400,
            end: 951_782_400,
        };
        assert_eq!(contest_dates(&one_day), "2000-02-29");
        let two_days = RankingContest {
            begin: 951_782_400,
            end: 951_868_800,
            ..one_day
        };
        assert_eq!(contest_dates(&two_days), "2000-02-29 – 2000-03-01");
    }

    /// The header reads the one shown contest, and the wording override is honoured only for that
    /// contest — words written for another day must not describe this one.
    #[test]
    fn the_header_words_come_from_the_shown_contest() {
        let contest = RankingContest {
            name: "POSN Day 2".to_string(),
            begin: 1_792_108_800,
            end: 1_792_195_200,
        };
        let row = Appearance {
            wording_overrides: Some(serde_json::json!({
                "9": { "title": "Day Two" },
                "3": { "subtitle": "ครั้งที่ 1" }
            })),
            ..appearance_for_header()
        };
        let header =
            BoardHeader::resolve(Some(&row), &shown(&[9]), Some(&contest)).expect("it resolves");
        assert_eq!(header.title, "Day Two", "the override words the title");
        assert_eq!(
            header.subtitle, "2026-10-16 – 2026-10-17",
            "the unoverridden line falls back to the contest's own dates"
        );
    }

    /// The row the header tests start from: nothing set but the fields a read always fills.
    fn appearance_for_header() -> Appearance {
        Appearance {
            title: None,
            subtitle: None,
            organisation: None,
            logo_asset: None,
            favicon_asset: None,
            theme: None,
            columns: None,
            score_format: None,
            footer_text: None,
            credits_text: None,
            credits: None,
            perspectives: None,
            wording_overrides: None,
            access_mode: "public".to_string(),
        }
    }
}
