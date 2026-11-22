//! Teams, and which of them a contestant may pick when registering.
//!
//! `src/cms/db/user.py:120-178` declares `teams` and the query a registration
//! form offers: a `contest_teams` row decides for that contest, and a team with no
//! row there falls back to its own `registerable` flag. The fallback is the whole
//! point — the column's default is `true`, so a contest that has never configured
//! its roster still offers every team.

use sqlx::postgres::{PgConnection, PgRow};
use sqlx::Row;

use crate::base::{Column, ColumnKind, Declaration};
use crate::codename::Codename;

/// The `teams` table (`src/cms/db/user.py:129-153`).
pub const TEAM: Declaration = Declaration {
    table: "teams",
    columns: &[
        Column::key("id", ColumnKind::Integer),
        Column::required("code", ColumnKind::Text),
        Column::required("name", ColumnKind::Text),
        Column::generated("registerable", ColumnKind::Boolean),
    ],
    relationships: &["participations"],
};

/// The teams a contest offers, with the contest's override already applied.
///
/// WHY the outer join rather than two queries: the reference's `COALESCE` needs the
/// absent row to be NULL, and an inner join would drop exactly the teams that fall
/// back.
const REGISTERABLE_TEAMS: &str = "\
    SELECT t.id, t.code, t.name, t.registerable \
    FROM teams t \
    LEFT JOIN contest_teams ct \
        ON ct.team_id = t.id AND ct.contest_id = $1 \
    WHERE COALESCE(ct.registerable, t.registerable) IS TRUE \
    ORDER BY t.id";

/// A row of `teams`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Team {
    /// `teams.id`.
    pub id: i32,
    /// `teams.code`, which the `CODENAME` domain admits.
    pub code: Codename,
    /// `teams.name`, the human-readable name.
    pub name: String,
    /// `teams.registerable`: the default a `contest_teams` row overrides.
    pub registerable: bool,
}

impl Team {
    /// The row a `SELECT` naming [`Team`]'s columns returned.
    fn from_row(row: &PgRow) -> Result<Self, sqlx::Error> {
        let code: String = row.try_get("code")?;
        Ok(Self {
            id: row.try_get("id")?,
            code: Codename::parse(&code).map_err(|error| sqlx::Error::Decode(Box::new(error)))?,
            name: row.try_get("name")?,
            registerable: row.try_get("registerable")?,
        })
    }
}

/// The teams a contestant registering in `contest_id` may pick.
///
/// `ORDER BY id` where the reference left the order to the planner, so a form built
/// from this does not reshuffle between two calls.
pub async fn registerable_teams(
    connection: &mut PgConnection,
    contest_id: i32,
) -> Result<Vec<Team>, sqlx::Error> {
    let rows = sqlx::query(REGISTERABLE_TEAMS)
        .bind(contest_id)
        .fetch_all(&mut *connection)
        .await?;
    rows.iter().map(Team::from_row).collect()
}
