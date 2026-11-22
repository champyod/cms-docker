//! The `tokens` row: `tokening.py:337-382`, where a play is a row and the quota is consulted before the submission's token.

use chrono::NaiveDateTime;
use sqlx::postgres::PgConnection;

use super::{Submission, SubmissionError};
use crate::base::{Column, ColumnKind, Declaration};
use crate::reads::SubmissionId;
use crate::task::{merge, Playable, TokenRules};

/// The `tokens` table (`src/cms/db/submission.py:249-275`).
pub const TOKEN: Declaration = Declaration {
    table: "tokens",
    columns: &[
        Column::key("id", ColumnKind::Integer),
        Column::reference("submission_id", ColumnKind::Integer),
        Column::generated("timestamp", ColumnKind::Timestamp),
    ],
    relationships: &["submission"],
};

/// Every play of one participation up to a timestamp: one read gives the contest's history and each task's.
pub const TOKEN_HISTORY: &str = "\
    SELECT t.timestamp, s.task_id
    FROM tokens AS t
    JOIN submissions AS s ON s.id = t.submission_id
    WHERE t.timestamp <= $1 AND s.participation_id = $2
    ORDER BY t.timestamp";

/// The columns the token on one submission is read with, bound to its submission id.
pub const TOKEN_BY_SUBMISSION: &str =
    "SELECT id, submission_id, timestamp FROM tokens WHERE submission_id = $1";

/// Writes one play, returning the id the row drew for itself.
pub const INSERT_TOKEN: &str =
    "INSERT INTO tokens (submission_id, timestamp) VALUES ($1, $2) RETURNING id";

/// One played token: which submission it was played on, and when.
#[derive(Debug, Clone, PartialEq, Eq, sqlx::FromRow)]
pub struct Token {
    /// `tokens.id`.
    pub id: i32,
    /// `tokens.submission_id`, unique: a submission carries at most one token.
    pub submission_id: i32,
    /// `tokens.timestamp`, the moment the play was accepted.
    pub timestamp: NaiveDateTime,
}

/// Why a play was refused, in the order the reference tests for it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum TokenRefusal {
    /// No token is available, or the wait between two plays has not expired.
    #[error("no token is available to play")]
    NoTokensAvailable,
    /// The submission already carries one, which is the reference's second check.
    #[error("a token was already played on this submission")]
    AlreadyPlayed,
}

/// What a play may draw on: the contest's rules, the task's, and when tokens began.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TokenBudget {
    /// The contest's own token columns (`contest.py:120-190`).
    pub contest: TokenRules,
    /// The task's, which the quota read here already carries.
    pub task: TokenRules,
    /// The instant tokens began accumulating: the contest's start, or the contestant's own.
    pub start: NaiveDateTime,
}

impl TokenBudget {
    /// The balance and the two times this participation's history leaves at `timestamp`.
    ///
    /// # Errors
    ///
    /// Returns [`SubmissionError::Database`] for a history the driver refused.
    pub async fn playable(
        &self,
        connection: &mut PgConnection,
        participation_id: i32,
        task_id: i32,
        timestamp: NaiveDateTime,
    ) -> Result<Playable, SubmissionError> {
        let plays: Vec<(NaiveDateTime, i32)> = sqlx::query_as(TOKEN_HISTORY)
            .bind(timestamp)
            .bind(participation_id)
            .fetch_all(connection)
            .await?;
        let contest_history: Vec<NaiveDateTime> = plays.iter().map(|(at, _)| *at).collect();
        let task_history: Vec<NaiveDateTime> = plays
            .iter()
            .filter(|(_, played_on)| *played_on == task_id)
            .map(|(at, _)| *at)
            .collect();
        Ok(merge(
            self.contest
                .available(self.start, &contest_history, timestamp),
            self.task.available(self.start, &task_history, timestamp),
        ))
    }
}

/// Plays a token on `submission`, consulting the quota first (`tokening.py:362-377`); check and insert are not one statement, as there.
///
/// # Errors
///
/// Returns [`SubmissionError::Refused`] with [`TokenRefusal`] for a play the quota
/// or the submission forbids, and [`SubmissionError::Database`] otherwise.
pub async fn accept_token(
    connection: &mut PgConnection,
    submission: &Submission,
    budget: &TokenBudget,
    timestamp: NaiveDateTime,
) -> Result<Token, SubmissionError> {
    let playable = budget
        .playable(
            connection,
            submission.record.participation_id,
            submission.record.task_id,
            timestamp,
        )
        .await?;
    if !playable.may_play() {
        return Err(SubmissionError::Refused(TokenRefusal::NoTokensAvailable));
    }
    if submission.token(connection).await?.is_some() {
        return Err(SubmissionError::Refused(TokenRefusal::AlreadyPlayed));
    }
    let id: i32 = sqlx::query_scalar(INSERT_TOKEN)
        .bind(submission.record.id.0)
        .bind(timestamp)
        .fetch_one(connection)
        .await?;
    Ok(Token {
        id,
        submission_id: submission.record.id.0,
        timestamp,
    })
}

/// The token `submission_id` carries, if any.
///
/// # Errors
///
/// Returns the driver's own error for a row it could not read.
pub async fn token_of(
    connection: &mut PgConnection,
    submission_id: SubmissionId,
) -> Result<Option<Token>, sqlx::Error> {
    sqlx::query_as::<_, Token>(TOKEN_BY_SUBMISSION)
        .bind(submission_id.0)
        .fetch_optional(connection)
        .await
}
