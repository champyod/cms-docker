//! The reads behind the decision, and the entry point that composes them.

use std::future::Future;

use cms_db::{effective_permissions, ADMIN_ENABLED};
use sqlx::PgConnection;

use crate::policy::{verdict, Access, AccessError};

/// The admin's row facts and resolved keys, or `None` when no row carries the id.
///
/// WHY the row is read as well as the keys: an empty resolved set cannot be told apart from an admin that does not exist, and the two need different answers.
/// A read that fails is returned, never folded into an empty set, because [`cms_db::PermissionError`] asks its caller to treat it as a denial.
pub async fn load_access(
    connection: &mut PgConnection,
    admin_id: i32,
) -> Result<Option<Access>, AccessError> {
    let enabled: Option<bool> = sqlx::query_scalar(ADMIN_ENABLED)
        .bind(admin_id)
        .fetch_optional(&mut *connection)
        .await
        .map_err(AccessError::Row)?;
    let Some(enabled) = enabled else {
        return Ok(None);
    };
    let effective = effective_permissions(connection, admin_id)
        .await
        .map_err(AccessError::Permissions)?;
    Ok(Some(Access { enabled, effective }))
}

/// The checker with the read supplied, so the order of its refusals is testable with no database.
///
/// WHY the id is checked before the read is called: the reference refuses an absent id without opening a session.
pub async fn authorize<Read, Pending>(
    read: Read,
    admin_id: Option<i32>,
    service: &str,
    method: &str,
) -> bool
where
    Read: FnOnce(i32) -> Pending,
    Pending: Future<Output = Result<Option<Access>, AccessError>>,
{
    match admin_id {
        None => false,
        Some(admin_id) => verdict(read(admin_id).await, service, method),
    }
}

/// Whether to accept the RPC request from this admin.
///
/// `shard` is accepted because the wire carries it; no rule in this crate reads it.
pub async fn rpc_authorization_checker(
    connection: &mut PgConnection,
    admin_id: Option<i32>,
    service: &str,
    _shard: i32,
    method: &str,
) -> bool {
    authorize(|id| load_access(connection, id), admin_id, service, method).await
}
