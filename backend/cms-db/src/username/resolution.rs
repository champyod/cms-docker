//! Which display name applies, and the alias rows behind it.
//!
//! `src/cms/db/username/resolution.py:94-133` answers two questions: may a user
//! configure an alias in this contest, and which name a row shows as. The
//! precedence itself is [`resolve_config`](crate::resolve_config); this module is
//! the half that reads the three policy scopes out of the database and hands
//! them to it, so the rule stays in one place.
//!
//! WHY the contest row ends the read: the reference returned as soon as it found
//! one (`resolution.py:83-85`) and never queried the narrower scopes, so a row
//! cannot exist there that this port would treat differently.

use std::collections::BTreeMap;

use sqlx::postgres::PgConnection;
use sqlx::Row;

use crate::codename::Codename;
use crate::user::User;
use crate::username::policy::{resolve_config, ConfigInputs, Policy};
use crate::username::UsernameError;

/// The row that decides for every participant in one contest.
const CONTEST_POLICY: &str = "\
    SELECT policy::text AS policy \
    FROM username_policies \
    WHERE scope = 'contest' AND scope_id = $1";

/// The rows that decide for the user each one names.
const USER_POLICIES: &str = "\
    SELECT scope_id, policy::text AS policy \
    FROM username_policies \
    WHERE scope = 'user' AND scope_id = ANY($1)";

/// Each user's group verdicts, joined on the group a policy names.
const GROUP_VERDICTS: &str = "\
    SELECT m.user_id, p.policy::text AS policy \
    FROM contestant_group_memberships m \
    JOIN username_policies p ON p.scope_id = m.group_id AND p.scope = 'group' \
    WHERE m.user_id = ANY($1)";

/// The aliases one contest holds for the users named.
const DISPLAY_USERNAMES: &str = "\
    SELECT user_id, username \
    FROM contest_usernames \
    WHERE contest_id = $1 AND user_id = ANY($2)";

/// The policy rows one contest and user set resolve to.
pub async fn load_config_inputs(
    connection: &mut PgConnection,
    contest_id: i32,
    user_ids: &[i32],
) -> Result<ConfigInputs, UsernameError> {
    let contest: Option<String> = sqlx::query_scalar(CONTEST_POLICY)
        .bind(contest_id)
        .fetch_optional(&mut *connection)
        .await?;
    let mut inputs = ConfigInputs {
        contest: contest.as_deref().and_then(Policy::of),
        ..ConfigInputs::default()
    };
    if inputs.contest.is_some() || user_ids.is_empty() {
        return Ok(inputs);
    }
    load_user_scopes(connection, user_ids, &mut inputs).await?;
    Ok(inputs)
}

/// Whether a user may configure a display username in a contest.
pub async fn username_config_allowed(
    connection: &mut PgConnection,
    contest_id: i32,
    user_id: i32,
) -> Result<bool, UsernameError> {
    let inputs = load_config_inputs(connection, contest_id, &[user_id]).await?;
    Ok(resolve_config(&inputs, &[user_id])
        .get(&user_id)
        .copied()
        .unwrap_or(false))
}

/// The display usernames a contest holds, keyed by user id.
pub async fn get_display_usernames(
    connection: &mut PgConnection,
    contest_id: i32,
    user_ids: &[i32],
) -> Result<BTreeMap<i32, Codename>, UsernameError> {
    if user_ids.is_empty() {
        return Ok(BTreeMap::new());
    }
    let rows = sqlx::query(DISPLAY_USERNAMES)
        .bind(contest_id)
        .bind(user_ids)
        .fetch_all(&mut *connection)
        .await?;
    let mut usernames = BTreeMap::new();
    for row in rows {
        let user_id: i32 = row.try_get("user_id")?;
        let username: String = row.try_get("username")?;
        usernames.insert(user_id, Codename::parse(&username)?);
    }
    Ok(usernames)
}

/// One user's display username in a contest, absent when unset.
pub async fn get_display_username(
    connection: &mut PgConnection,
    contest_id: i32,
    user_id: i32,
) -> Result<Option<Codename>, UsernameError> {
    Ok(get_display_usernames(connection, contest_id, &[user_id])
        .await?
        .get(&user_id)
        .cloned())
}

/// The name to show: the alias when the contest allows one and it is set, else
/// the real name.
pub async fn get_display_name(
    connection: &mut PgConnection,
    contest_id: i32,
    user: &User,
) -> Result<String, UsernameError> {
    if username_config_allowed(connection, contest_id, user.id).await? {
        if let Some(username) = get_display_username(connection, contest_id, user.id).await? {
            return Ok(username.as_str().to_owned());
        }
    }
    Ok(format!("{} {}", user.first_name, user.last_name))
}

/// Fill the user and group scopes, which only matter when no contest row exists.
async fn load_user_scopes(
    connection: &mut PgConnection,
    user_ids: &[i32],
    inputs: &mut ConfigInputs,
) -> Result<(), UsernameError> {
    let rows = sqlx::query(USER_POLICIES)
        .bind(user_ids)
        .fetch_all(&mut *connection)
        .await?;
    for row in rows {
        let scope_id: i32 = row.try_get("scope_id")?;
        let policy: String = row.try_get("policy")?;
        if let Some(policy) = Policy::of(&policy) {
            inputs.users.insert(scope_id, policy);
        }
    }

    let rows = sqlx::query(GROUP_VERDICTS)
        .bind(user_ids)
        .fetch_all(&mut *connection)
        .await?;
    for row in rows {
        let user_id: i32 = row.try_get("user_id")?;
        let policy: String = row.try_get("policy")?;
        if policy == "deny" {
            inputs.group_denied.insert(user_id);
        } else {
            inputs.group_allowed.insert(user_id);
        }
    }
    Ok(())
}
