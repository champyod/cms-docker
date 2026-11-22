//! The balance a token quota leaves: how many are left, when the next arrives.

use chrono::NaiveDateTime;

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
    pub(super) fn of(balance: i64) -> Self {
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

    /// Whether a token may be played now: `accept_token` compares `== 0` (`tokening.py:365`), and no negative exists here to read as tokens left.
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
