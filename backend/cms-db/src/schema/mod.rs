//! The database schema this crate creates: `init_db`, from the reference's own DDL.
//!
//! The statements are pg_dump's rendering of what `cms.db.init_db` created, frozen at
//! `dev/fixtures/cms_schema.sql`, so no table was translated by reading a model.
//! Order is the dump's own, and each part is one batch whose failure names its objects.
//!
//! Two things the dump carries are dropped: `OWNER TO`, because the objects belong to
//! whichever role runs the create, and the `SET` lines, which configure pg_dump's
//! session. Column order, `NOT NULL` and every check and constraint name stay verbatim,
//! since callers read the name in a constraint-violation error.
//!
//! Thirteen tables the models declare are absent, because `init.py` excludes them and
//! Prisma migrations own their creation: the permission tables, `audit_log`,
//! `security_blocks`, and the display-username and `contest_teams` tables.

use sqlx::postgres::PgConnection;

/// The ordered batches, named so a failure says which objects it was creating.
const PARTS: &[(&str, &str)] = &[
    ("domains", include_str!("../../sql/domains.sql")),
    ("enums", include_str!("../../sql/enums.sql")),
    ("tables_01", include_str!("../../sql/tables_01.sql")),
    ("tables_02", include_str!("../../sql/tables_02.sql")),
    ("tables_03", include_str!("../../sql/tables_03.sql")),
    ("tables_04", include_str!("../../sql/tables_04.sql")),
    ("sequences", include_str!("../../sql/sequences.sql")),
    ("defaults", include_str!("../../sql/defaults.sql")),
    ("constraints", include_str!("../../sql/constraints.sql")),
    ("indexes", include_str!("../../sql/indexes.sql")),
    ("foreign_keys", include_str!("../../sql/foreign_keys.sql")),
];

/// Create every CMS-owned table, domain, enum, sequence, index and constraint.
///
/// The schema must be empty: the reference's `create_all` skipped a table that
/// existed but still re-issued the domain DDL, so a second run failed there too.
pub async fn init_db(connection: &mut PgConnection) -> Result<(), SchemaError> {
    for (part, sql) in PARTS {
        sqlx::raw_sql(*sql)
            .execute(&mut *connection)
            .await
            .map_err(|source| SchemaError::Refused { part, source })?;
    }
    Ok(())
}

/// Why the schema could not be created.
#[derive(Debug, thiserror::Error)]
pub enum SchemaError {
    /// A batch was refused, and the batch names the objects it was creating.
    #[error("creating the {part} part of the schema was refused: {source}")]
    Refused {
        /// The batch that failed.
        part: &'static str,
        /// What the server refused.
        #[source]
        source: sqlx::Error,
    },
}
