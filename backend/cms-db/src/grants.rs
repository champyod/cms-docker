//! The permission rows one admin's key set is resolved from.
//!
//! `permissions.py` declares the five tables — `permissions` itself, `groups`,
//! `group_permissions`, `admin_groups` and `admin_permission_overrides` — and
//! `get_effective_permissions` (`src/cms/server/admin/handlers/base.py:240-311`)
//! reads them in one fixed order:
//!
//! 1. the keys reached from `admin_groups` through `group_permissions`;
//! 2. united with the per-person `allow` overrides;
//! 3. the wildcard expanded into every key the `permissions` table holds, unless
//!    the wildcard itself is denied;
//! 4. the per-person `deny` overrides subtracted last.
//!
//! [`resolve`](crate::resolve) is that order, and it is a pure function; this
//! module only supplies the rows. The expansion before the subtraction is what
//! makes a deny on one key win over a wildcard grant, and the subtraction after
//! the union is what makes a deny win over an allow.
//!
//! # Failing closed
//!
//! A missing or disabled admin resolves to no keys, as the reference answers
//! (`base.py:248-256`). A query that fails is [`PermissionError`], not an empty
//! set: the reference folds its own query errors into `frozenset()`
//! (`base.py:265-271`, `base.py:300-305`), and a caller that must refuse on
//! error gets the same denial while the failure stays visible instead of
//! disappearing into a permission outage nobody notices.
//!
//! The reference caches a resolved set for a few seconds (`base.py:263-275`).
//! The cache and its invalidation hook stay with the request layer that owns the
//! rows' lifetime; this read is always the database's current answer.

use std::collections::BTreeSet;

use sqlx::{Connection, PgConnection};

use crate::base::{Column, ColumnKind, Declaration};
use crate::permission::{resolve, EffectivePermissions, PermissionInputs};

/// The `permissions` table.
pub const PERMISSION: Declaration = Declaration {
    table: "permissions",
    columns: &[
        Column::key("id", ColumnKind::Integer),
        Column::required("key", ColumnKind::Text),
        Column::required("module", ColumnKind::Text),
        Column::required("verb", ColumnKind::Text),
        Column::optional("description", ColumnKind::Text),
    ],
    relationships: &["group_permissions", "admin_permission_overrides"],
};

/// The `groups` table.
pub const GROUP: Declaration = Declaration {
    table: "groups",
    columns: &[
        Column::key("id", ColumnKind::Integer),
        Column::required("name", ColumnKind::Text),
        Column::optional("description", ColumnKind::Text),
        Column::generated("is_seeded", ColumnKind::Boolean),
        Column::generated("created_at", ColumnKind::Timestamp),
    ],
    relationships: &["group_permissions", "admin_groups"],
};

/// The `group_permissions` table.
pub const GROUP_PERMISSION: Declaration = Declaration {
    table: "group_permissions",
    columns: &[
        Column::key("id", ColumnKind::Integer),
        Column::reference("group_id", ColumnKind::Integer),
        Column::reference("permission_id", ColumnKind::Integer),
    ],
    relationships: &["group", "permission"],
};

/// The `admin_groups` table.
pub const ADMIN_GROUP: Declaration = Declaration {
    table: "admin_groups",
    columns: &[
        Column::key("id", ColumnKind::Integer),
        Column::reference("admin_id", ColumnKind::Integer),
        Column::reference("group_id", ColumnKind::Integer),
    ],
    relationships: &["group"],
};

/// The `admin_permission_overrides` table.
pub const ADMIN_PERMISSION_OVERRIDE: Declaration = Declaration {
    table: "admin_permission_overrides",
    columns: &[
        Column::key("id", ColumnKind::Integer),
        Column::reference("admin_id", ColumnKind::Integer),
        Column::reference("permission_id", ColumnKind::Integer),
        Column::required("effect", ColumnKind::Text),
        Column::optional("reason", ColumnKind::Text),
    ],
    relationships: &["permission"],
};

/// Whether the admin row exists and is enabled, bound to the admin id as `$1`.
pub const ADMIN_ENABLED: &str = "SELECT enabled FROM admins WHERE id = $1";

/// The keys the admin's groups grant, bound to the admin id as `$1`.
pub const GROUP_GRANT_KEYS: &str = "\
    SELECT p.key
    FROM permissions AS p
    JOIN group_permissions AS gp ON gp.permission_id = p.id
    JOIN admin_groups AS ag ON ag.group_id = gp.group_id
    WHERE ag.admin_id = $1";

/// The keys the admin's own `allow` overrides name, bound as `$1`.
pub const ALLOW_OVERRIDE_KEYS: &str = "\
    SELECT p.key
    FROM permissions AS p
    JOIN admin_permission_overrides AS o ON o.permission_id = p.id
    WHERE o.admin_id = $1 AND o.effect = 'allow'";

/// The keys the admin's own `deny` overrides name, bound as `$1`.
pub const DENY_OVERRIDE_KEYS: &str = "\
    SELECT p.key
    FROM permissions AS p
    JOIN admin_permission_overrides AS o ON o.permission_id = p.id
    WHERE o.admin_id = $1 AND o.effect = 'deny'";

/// Every key the `permissions` table holds, which the wildcard expands into.
pub const REGISTERED_KEYS: &str = "SELECT key FROM permissions";

/// Why a permission set could not be resolved.
#[derive(Debug, thiserror::Error)]
pub enum PermissionError {
    /// A row could not be read. The caller must refuse; this is never a grant.
    #[error("resolving effective permissions failed: {0}")]
    Database(#[from] sqlx::Error),
}

/// The keys one admin holds, read from the rows in `permissions` and its joins.
///
/// The four reads run in one transaction, so a grant removed halfway through
/// cannot leave the set holding a key from before the change and an allow from
/// after it.
///
/// # Errors
///
/// [`PermissionError::Database`] when a read fails; a caller must treat that as
/// a denial, because the reference's empty answer for the same failure is the
/// answer this stands in for.
pub async fn effective_permissions(
    connection: &mut PgConnection,
    admin_id: i32,
) -> Result<EffectivePermissions, PermissionError> {
    let mut transaction = connection.begin().await?;
    let enabled: Option<bool> = sqlx::query_scalar(ADMIN_ENABLED)
        .bind(admin_id)
        .fetch_optional(&mut *transaction)
        .await?;
    if enabled != Some(true) {
        transaction.rollback().await?;
        return Ok(EffectivePermissions::none());
    }

    let inputs = PermissionInputs {
        is_enabled: true,
        group_grants: admin_keys(&mut transaction, GROUP_GRANT_KEYS, admin_id).await?,
        allow_overrides: admin_keys(&mut transaction, ALLOW_OVERRIDE_KEYS, admin_id).await?,
        deny_overrides: admin_keys(&mut transaction, DENY_OVERRIDE_KEYS, admin_id).await?,
        registered_keys: all_keys(&mut transaction).await?,
    };
    transaction.commit().await?;
    Ok(resolve(&inputs))
}

/// One admin-bound key query, as a set.
async fn admin_keys(
    connection: &mut PgConnection,
    sql: &'static str,
    admin_id: i32,
) -> Result<BTreeSet<String>, sqlx::Error> {
    let rows = sqlx::query_scalar::<_, String>(sql)
        .bind(admin_id)
        .fetch_all(connection)
        .await?;
    Ok(rows.into_iter().collect())
}

/// The whole `permissions` key set, as a set.
async fn all_keys(connection: &mut PgConnection) -> Result<BTreeSet<String>, sqlx::Error> {
    let rows = sqlx::query_scalar::<_, String>(REGISTERED_KEYS)
        .fetch_all(connection)
        .await?;
    Ok(rows.into_iter().collect())
}
