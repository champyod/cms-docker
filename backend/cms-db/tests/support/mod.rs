//! The schema a file-store test needs, created once per test binary.
//!
//! Cargo runs test binaries one after another, so a binary that owns this helper
//! also owns the table for its whole run; tests inside one binary share it and
//! stay independent by using content of their own.

use sqlx::postgres::PgConnection;

/// The `DIGEST` domain, as `cms.db.types.Digest.get_create_command` declares it.
const CREATE_DOMAIN: &str = "\
    DO $$ BEGIN \
        CREATE DOMAIN digest AS varchar CHECK (VALUE ~ '^([0-9a-f]{40}|x)$'); \
    EXCEPTION WHEN duplicate_object THEN NULL; \
    END $$";

/// `fsobjects`, as the model declares it: the digest is the primary key and the
/// oid starts at the column's default 0.
const CREATE_FSOBJECTS: &str = "\
    CREATE TABLE IF NOT EXISTS fsobjects (\
        digest digest PRIMARY KEY, \
        loid oid NOT NULL DEFAULT 0, \
        description varchar)";

/// Create both, leaving an existing pair alone.
pub async fn create(connection: &mut PgConnection) {
    for statement in [CREATE_DOMAIN, CREATE_FSOBJECTS] {
        sqlx::query(statement)
            .execute(&mut *connection)
            .await
            .expect("creating the file-store schema");
    }
}
