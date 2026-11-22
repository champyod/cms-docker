//! The precedence one instance's contest is settled by.
//!
//! Flat, in this order: an explicit `-c` override, else the row the registry
//! authors for this `(role, shard)`, else the deployment default. A null row
//! means every contest, which is the multicontest mode a contest server serves
//! behind a `/<name>/` prefix.

use sqlx::postgres::PgConnection;

use super::{active_contest, service_binding, BindingError};

/// What a `-c` argument fixed an instance to, or that it fixed nothing.
///
/// WHY three values and not an `Option`: "every contest" folded into "no override" binds the instance to the registry's contest.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContestOverride {
    /// `-c <id>`: this contest, whatever the registry or the flag says.
    Contest(i32),
    /// `-c` naming every contest: the multicontest shape, and no lookup.
    EveryContest,
    /// No `-c`: resolve per call, registry row first and the default after it.
    Registry,
}

/// The absence of a `-c` override.
pub const NO_OVERRIDE: ContestOverride = ContestOverride::Registry;

/// The contest one instance serves right now.
///
/// `serves_one_contest` is whether the caller can serve every contest at once; a
/// caller that cannot is refused rather than handed `None`.
///
/// # Errors
///
/// [`BindingError::EveryContestOnSingleContestService`] when the answer is every
/// contest and the caller serves one, and whatever the lookup reports.
pub async fn contest_binding(
    connection: &mut PgConnection,
    role: &str,
    shard: i32,
    contest_override: ContestOverride,
    serves_one_contest: bool,
) -> Result<Option<i32>, BindingError> {
    let contest_id = match contest_override {
        ContestOverride::Contest(contest_id) => Some(contest_id),
        ContestOverride::EveryContest => None,
        ContestOverride::Registry => registry_then_default(connection, role, shard).await?,
    };
    if contest_id.is_none() && serves_one_contest {
        return Err(BindingError::EveryContestOnSingleContestService {
            role: role.to_owned(),
            shard,
        });
    }
    Ok(contest_id)
}

/// The registry's row when it names this instance, else the deployment default.
async fn registry_then_default(
    connection: &mut PgConnection,
    role: &str,
    shard: i32,
) -> Result<Option<i32>, BindingError> {
    let binding = service_binding(&mut *connection, role, shard).await?;
    if binding.named {
        return Ok(binding.contest_id);
    }
    Ok(Some(active_contest(connection).await?))
}
