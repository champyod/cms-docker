//! A task's token quota: the columns that set it, and the balance they compute.
//!
//! `tokening.py:52-176` rebuilds the balance from the whole play history rather than
//! storing a counter, so a balance is a function of the history and one timestamp.

use chrono::{Duration, NaiveDateTime};

use crate::interval::Interval;

/// How many tokens a task grants at all (`tasks.token_mode`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenMode {
    /// `disabled`: a token can never be played on this task.
    Disabled,
    /// `finite`: a balance that generation refills, capped by the columns beside it.
    Finite,
    /// `infinite`: a token can always be played, and no limit applies.
    Infinite,
}

impl TokenMode {
    /// The value the `token_mode` enum stores.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Disabled => "disabled",
            Self::Finite => "finite",
            Self::Infinite => "infinite",
        }
    }

    /// The mode a column value names, or `None` for one the enum does not declare.
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "disabled" => Some(Self::Disabled),
            "finite" => Some(Self::Finite),
            "infinite" => Some(Self::Infinite),
            _ => None,
        }
    }
}

/// The seven `tasks` columns a balance is computed from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TokenRules {
    /// `tasks.token_mode`.
    pub mode: TokenMode,
    /// `tasks.token_max_number`: plays over the whole contest, absent for no ceiling.
    pub max_number: Option<i32>,
    /// `tasks.token_min_interval`: the wait between two plays.
    pub min_interval: Interval,
    /// `tasks.token_gen_initial`: the balance a contestant starts with.
    pub gen_initial: i32,
    /// `tasks.token_gen_number`: how many each generation period adds.
    pub gen_number: i32,
    /// `tasks.token_gen_interval`: how long one generation period lasts.
    pub gen_interval: Interval,
    /// `tasks.token_gen_max`: the balance generation stops adding at.
    pub gen_max: Option<i32>,
}

/// The column defaults of a task that grants no tokens: `task.py:132-174`.
const DEFAULT_GEN_INITIAL: i32 = 2;
const DEFAULT_GEN_NUMBER: i32 = 2;
const DEFAULT_MINUTES_PER_PERIOD: i64 = 30;

impl TokenRules {
    /// A task with no tokens: `TOKEN_MODE_DISABLED` and the columns' own defaults.
    #[must_use]
    pub const fn disabled() -> Self {
        Self {
            mode: TokenMode::Disabled,
            max_number: None,
            min_interval: Interval::zero(),
            gen_initial: DEFAULT_GEN_INITIAL,
            gen_number: DEFAULT_GEN_NUMBER,
            gen_interval: Interval::from_micros(
                DEFAULT_MINUTES_PER_PERIOD * crate::MICROS_PER_MINUTE,
            ),
            gen_max: None,
        }
    }

    /// The balance this history leaves at `timestamp`, in the reference's three pieces.
    ///
    /// `start` is when tokens began accumulating: the contest's start, or the
    /// contestant's own when the contest gives each of them their own window.
    #[must_use]
    pub fn available(
        &self,
        start: NaiveDateTime,
        history: &[NaiveDateTime],
        timestamp: NaiveDateTime,
    ) -> Playable {
        if self.mode == TokenMode::Disabled {
            return Playable::none();
        }
        if self.mode == TokenMode::Infinite {
            return Playable::infinite();
        }

        let mut balance = i64::from(self.gen_initial);
        let mut previous = start;
        for played in history {
            balance = self.capped(balance + self.generated(start, previous, *played));
            balance -= 1;
            previous = *played;
        }
        balance = self.capped(balance + self.generated(start, previous, timestamp));

        let mut next_generation = self.next_generation(start, timestamp, balance);
        if let Some(max_number) = self.max_number {
            let allowance = i64::from(max_number) - history.len() as i64;
            if balance >= allowance {
                balance = allowance;
                next_generation = None;
            }
        }

        Playable {
            available: Tokens::of(balance),
            next_generation,
            playable_from: self.playable_from(start, history, timestamp, balance, next_generation),
        }
    }

    /// What generation adds between two instants, at whole periods only.
    fn generated(&self, start: NaiveDateTime, begin: NaiveDateTime, end: NaiveDateTime) -> i64 {
        let periods = periods_at(self, start, end) - periods_at(self, start, begin);
        i64::from(self.gen_number) * periods
    }

    /// Holds the balance at `token_gen_max`, which generation may not exceed.
    fn capped(&self, balance: i64) -> i64 {
        match self.gen_max {
            Some(max) => balance.min(i64::from(max)),
            None => balance,
        }
    }

    /// When the next token is generated, and `None` when generation has stopped for good.
    fn next_generation(
        &self,
        start: NaiveDateTime,
        timestamp: NaiveDateTime,
        balance: i64,
    ) -> Option<NaiveDateTime> {
        let still_growing = self.gen_max.is_none_or(|max| balance < i64::from(max));
        if self.gen_number <= 0 || !still_growing {
            return None;
        }
        Some(start + self.period_span(periods_at(self, start, timestamp) + 1))
    }

    /// When the wait since the last play expires, and `None` when nothing blocks a play.
    fn playable_from(
        &self,
        start: NaiveDateTime,
        history: &[NaiveDateTime],
        timestamp: NaiveDateTime,
        balance: i64,
        next_generation: Option<NaiveDateTime>,
    ) -> Option<NaiveDateTime> {
        let expiry = history
            .last()
            .map_or(start, |last| *last + self.min_interval.to_duration());
        if expiry <= timestamp || (balance == 0 && next_generation.is_none()) {
            return None;
        }
        Some(expiry)
    }

    /// A whole number of generation periods as a duration.
    fn period_span(&self, periods: i64) -> Duration {
        Duration::microseconds(self.gen_interval.as_micros().saturating_mul(periods))
    }
}

/// How many whole generation periods separate `start` from `at`, floored as the reference's `//`.
fn periods_at(rules: &TokenRules, start: NaiveDateTime, at: NaiveDateTime) -> i64 {
    let period = rules.gen_interval.as_micros();
    if period <= 0 {
        return 0;
    }
    let elapsed = at
        .signed_duration_since(start)
        .num_microseconds()
        .unwrap_or(0);
    elapsed.div_euclid(period)
}

/// How many tokens a contestant has left.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tokens {
    /// `-1` in the reference: no balance is kept, so no play spends anything.
    Infinite,
    /// A finite balance, which a contestant can never owe.
    Count(u32),
}

impl Tokens {
    /// The finite balance, or `None` when tokens are infinite.
    #[must_use]
    pub const fn count(self) -> Option<u32> {
        match self {
            Self::Infinite => None,
            Self::Count(count) => Some(count),
        }
    }

    /// The finite balance as a count, never below zero: an overspent quota owes nothing.
    fn of(balance: i64) -> Self {
        Self::Count(u32::try_from(balance.max(0)).unwrap_or(u32::MAX))
    }
}

/// The three values `tokens_available` returns, kept together so one cannot be read alone.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Playable {
    /// How many tokens are left, or [`Tokens::Infinite`].
    pub available: Tokens,
    /// When the next token is generated, absent when none ever will be.
    pub next_generation: Option<NaiveDateTime>,
    /// When the wait since the last play expires, absent when nothing blocks one.
    pub playable_from: Option<NaiveDateTime>,
}

impl Playable {
    /// A task that grants nothing.
    #[must_use]
    pub const fn none() -> Self {
        Self {
            available: Tokens::Count(0),
            next_generation: None,
            playable_from: None,
        }
    }

    /// A task that grants without limit.
    #[must_use]
    pub const fn infinite() -> Self {
        Self {
            available: Tokens::Infinite,
            next_generation: None,
            playable_from: None,
        }
    }

    /// Whether a token may be played now: `accept_token`'s condition (`tokening.py:365`).
    ///
    /// The reference compares `== 0`, so a balance it clamped below zero reads as
    /// tokens left and grants one; [`Tokens`] holds no negative, so this refuses it.
    #[must_use]
    pub const fn may_play(&self) -> bool {
        !matches!(self.available, Tokens::Count(0)) && self.playable_from.is_none()
    }
}

/// The one balance two rule sets leave: `tokens_available`'s merge (`tokening.py:270-316`).
#[must_use]
pub fn merge(contest: Playable, task: Playable) -> Playable {
    let playable_from = match (contest.playable_from, task.playable_from) {
        (Some(contest), Some(task)) => Some(contest.max(task)),
        (only, None) | (None, only) => only,
    };
    let Some((contest_left, task_left)) = comparable(contest.available, task.available) else {
        return Playable {
            available: Tokens::Infinite,
            next_generation: None,
            playable_from,
        };
    };
    let narrower = narrower(
        contest_left,
        task_left,
        contest.next_generation,
        task.next_generation,
    );
    Playable {
        available: narrower.0,
        next_generation: narrower.1,
        playable_from,
    }
}

/// The pair to compare, with an infinite side read as one more than the other.
fn comparable(contest: Tokens, task: Tokens) -> Option<(Tokens, Tokens)> {
    match (contest, task) {
        (Tokens::Infinite, Tokens::Infinite) => None,
        (Tokens::Infinite, Tokens::Count(task)) => {
            Some((Tokens::Count(task.saturating_add(1)), Tokens::Count(task)))
        }
        (Tokens::Count(contest), Tokens::Infinite) => Some((
            Tokens::Count(contest),
            Tokens::Count(contest.saturating_add(1)),
        )),
        (Tokens::Count(contest), Tokens::Count(task)) => {
            Some((Tokens::Count(contest), Tokens::Count(task)))
        }
    }
}

/// The stricter side's balance and generation time, or the later of two equal ones.
fn narrower(
    contest: Tokens,
    task: Tokens,
    contest_generation: Option<NaiveDateTime>,
    task_generation: Option<NaiveDateTime>,
) -> (Tokens, Option<NaiveDateTime>) {
    match (contest.count(), task.count()) {
        (Some(contest), Some(task)) if contest < task => (contest.into(), contest_generation),
        (Some(contest), Some(task)) if task < contest => (task.into(), task_generation),
        _ => {
            let both = match (contest_generation, task_generation) {
                (Some(contest), Some(task)) => Some(contest.max(task)),
                _ => None,
            };
            (task, both)
        }
    }
}

impl From<u32> for Tokens {
    fn from(count: u32) -> Self {
        Self::Count(count)
    }
}
