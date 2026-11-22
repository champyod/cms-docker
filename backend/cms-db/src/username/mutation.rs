//! Setting and removing a display username, and the history each change appends.
//!
//! `src/cms/db/username/resolution.py:185-211` is the write: one alias row per
//! participation, one append-only history row per change, and a refusal when the
//! name already belongs to another user in the same contest.
//!
//! Three orderings the reference fixes, and this port keeps:
//!
//! - a name that is already the row's own is not a change, so it appends no
//!   history row and writes nothing (`:201-202`);
//! - removal appends a history row whose username is NULL before deleting the
//!   alias, so the record of the name survives its row (`:195-199`);
//! - the history row goes in before the alias is created or updated (`:204-210`),
//!   which is what makes the history a log of what was asked for even when the
//!   write after it fails.
//!
//! The caller commits, as in the reference: every statement here runs on the
//! connection it is given, so a caller holding a [`Transaction`](crate::Transaction)
//! gets all of them or none.

use chrono::NaiveDateTime;
use sqlx::postgres::PgConnection;

use crate::codename::Codename;
use crate::user::Participation;
use crate::username::models::DisplayUsername;
use crate::username::UsernameError;

/// The alias one participation holds, of which the table allows at most one.
const FIND_BY_PARTICIPATION: &str = "\
    SELECT id, participation_id, contest_id, user_id, username, updated_at, updated_by_admin_id \
    FROM contest_usernames \
    WHERE participation_id = $1 \
    LIMIT 1";

/// Whether another user in the contest already holds the name.
const HELD_BY_ANOTHER: &str = "\
    SELECT 1 \
    FROM contest_usernames \
    WHERE contest_id = $1 AND username = $2 AND user_id <> $3 \
    LIMIT 1";

/// The log row every change appends, with a NULL username for a removal.
const APPEND_HISTORY: &str = "\
    INSERT INTO contest_usernames_history (contest_id, user_id, username, set_at, set_by_admin_id) \
    VALUES ($1, $2, $3, $4, $5)";

const CREATE_ALIAS: &str = "\
    INSERT INTO contest_usernames \
        (participation_id, contest_id, user_id, username, updated_at, updated_by_admin_id) \
    VALUES ($1, $2, $3, $4, $5, $6) \
    RETURNING id, participation_id, contest_id, user_id, username, updated_at, updated_by_admin_id";

const UPDATE_ALIAS: &str = "\
    UPDATE contest_usernames \
    SET username = $1, updated_at = $2, updated_by_admin_id = $3 \
    WHERE id = $4 \
    RETURNING id, participation_id, contest_id, user_id, username, updated_at, updated_by_admin_id";

/// The alias row is the history's subject, so the row goes after its last entry.
const DELETE_ALIAS: &str = "DELETE FROM contest_usernames WHERE id = $1";

/// Set, rename or remove one participation's display username.
///
/// `username` of `None` removes the alias and returns `None`; an unchanged name
/// returns the row it already has without writing anything.
pub async fn set_display_username(
    connection: &mut PgConnection,
    participation: &Participation,
    username: Option<&Codename>,
    timestamp: NaiveDateTime,
    admin: Option<i32>,
) -> Result<Option<DisplayUsername>, UsernameError> {
    let record = find_record(connection, participation.id).await?;

    let Some(username) = username else {
        if let Some(record) = &record {
            append_history(connection, participation, None, timestamp, admin).await?;
            sqlx::query(DELETE_ALIAS)
                .bind(record.id)
                .execute(&mut *connection)
                .await?;
        }
        return Ok(None);
    };

    if let Some(record) = &record {
        if record.username == *username {
            return Ok(Some(record.clone()));
        }
    }

    assert_username_free(connection, participation, username).await?;
    append_history(connection, participation, Some(username), timestamp, admin).await?;

    let row = match &record {
        Some(record) => {
            sqlx::query(UPDATE_ALIAS)
                .bind(username.as_str())
                .bind(timestamp)
                .bind(admin)
                .bind(record.id)
                .fetch_one(&mut *connection)
                .await?
        }
        None => {
            sqlx::query(CREATE_ALIAS)
                .bind(participation.id)
                .bind(participation.contest_id)
                .bind(participation.user_id)
                .bind(username.as_str())
                .bind(timestamp)
                .bind(admin)
                .fetch_one(&mut *connection)
                .await?
        }
    };
    Ok(Some(DisplayUsername::from_row(&row)?))
}

/// The alias the participation holds, if any.
async fn find_record(
    connection: &mut PgConnection,
    participation_id: i32,
) -> Result<Option<DisplayUsername>, UsernameError> {
    let row = sqlx::query(FIND_BY_PARTICIPATION)
        .bind(participation_id)
        .fetch_optional(&mut *connection)
        .await?;
    row.as_ref()
        .map(DisplayUsername::from_row)
        .transpose()
        .map_err(Into::into)
}

/// Refuse a name another user of the same contest already holds.
///
/// WHY not also map the unique index's violation: the reference let a lost race
/// surface as the driver's error, and this pre-check is the refusal it defined.
async fn assert_username_free(
    connection: &mut PgConnection,
    participation: &Participation,
    username: &Codename,
) -> Result<(), UsernameError> {
    let held = sqlx::query(HELD_BY_ANOTHER)
        .bind(participation.contest_id)
        .bind(username.as_str())
        .bind(participation.user_id)
        .fetch_optional(&mut *connection)
        .await?;
    if held.is_some() {
        return Err(UsernameError::Taken);
    }
    Ok(())
}

/// Append the log row, whether the change sets a name or clears one.
async fn append_history(
    connection: &mut PgConnection,
    participation: &Participation,
    username: Option<&Codename>,
    timestamp: NaiveDateTime,
    admin: Option<i32>,
) -> Result<(), UsernameError> {
    sqlx::query(APPEND_HISTORY)
        .bind(participation.contest_id)
        .bind(participation.user_id)
        .bind(username.map(Codename::as_str))
        .bind(timestamp)
        .bind(admin)
        .execute(&mut *connection)
        .await?;
    Ok(())
}
