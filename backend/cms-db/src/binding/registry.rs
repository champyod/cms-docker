//! The `services` row that names the contest one instance serves.
//!
//! The table is the deployment's registry, created by the admin panel's
//! `service_wiring_registry` migration, and a row is what an operator edits to
//! re-point a running instance. The read is therefore keyed by this instance's
//! `(role, shard)`: the registry authors one row per instance, so reading the
//! first row of a role handed every server the same contest.

use sqlx::postgres::PgConnection;

use crate::base::{Column, ColumnKind, Declaration};

use super::{table_exists, BindingError};

/// The `services` table, as the registry migration creates it.
pub const SERVICE: Declaration = Declaration {
    table: "services",
    columns: &[
        Column::key("id", ColumnKind::Integer),
        Column::required("name", ColumnKind::Text),
        Column::required("role", ColumnKind::Text),
        Column::generated("shard", ColumnKind::Integer),
        Column::required("host", ColumnKind::Text),
        Column::optional_reference("contest_id", ColumnKind::Integer),
        Column::generated("enabled", ColumnKind::Boolean),
    ],
    relationships: &["contest", "wirings"],
};

/// Whether the registry exists, asked of the catalogue before the read.
///
/// WHY the catalogue and not a caught `42P01`: a refused statement leaves the caller's transaction unusable.
const SERVICES_EXIST: &str = "SELECT to_regclass('services') IS NOT NULL";

/// The contest this instance's enabled row names, bound as `$1` and `$2`.
pub const SERVICE_BINDING: &str = "\
    SELECT contest_id FROM services \
    WHERE role = $1 AND shard = $2 AND enabled \
    ORDER BY id LIMIT 1";

/// What the registry says about one running instance.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ServiceBinding {
    /// Whether a row names this `(role, shard)` at all.
    pub named: bool,
    /// The contest that row names, or `None` when it names every contest.
    pub contest_id: Option<i32>,
}

impl ServiceBinding {
    /// The answer for an instance no row names.
    const fn unnamed() -> Self {
        Self {
            named: false,
            contest_id: None,
        }
    }
}

/// The registry's row for one `(role, shard)`, or that no row names it.
///
/// A row whose `contest_id` is NULL means every contest, which is the
/// multicontest mode a contest server serves behind a `/<name>/` prefix; no row
/// at all means the deployment default decides. Folding the two answers together
/// would bind a null-named instance to the active contest.
///
/// # Errors
///
/// [`BindingError::Database`] when a read is refused; only the missing table is
/// answered, and it is answered as "no row names this instance".
pub async fn service_binding(
    connection: &mut PgConnection,
    role: &str,
    shard: i32,
) -> Result<ServiceBinding, BindingError> {
    if !table_exists(connection, SERVICES_EXIST).await? {
        return Ok(ServiceBinding::unnamed());
    }
    let named: Option<Option<i32>> = sqlx::query_scalar(SERVICE_BINDING)
        .bind(role)
        .bind(shard)
        .fetch_optional(&mut *connection)
        .await?;
    Ok(match named {
        Some(contest_id) => ServiceBinding {
            named: true,
            contest_id,
        },
        None => ServiceBinding::unnamed(),
    })
}
