//! A task's token quota: `tokening.py:52-176` rebuilds the balance from the play history rather than storing a counter.

use chrono::{Duration, NaiveDateTime};

use super::quota::{Playable, Tokens};
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

    /// The balance this history leaves at `timestamp`, counting from `start`, when tokens began accumulating.
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
