//! Empty the database: the teardown behind the drop verb.
//!
//! `metadata.drop_all()` cannot handle a database whose content does not fit the
//! schema the models describe, so the teardown does what the reference does: drop
//! schema `public`, recreate it, and unlink every large object. A database set up
//! with a different default schema is as out of scope here as it was there.
//!
//! It runs on the dedicated connection, outside the pool and stamped for its
//! lifetime, and each statement is its own transaction: the reference had to set
//! autocommit, because psycopg2 opens one implicitly, while this driver issues a
//! statement outside an explicit transaction by itself.
//!
//! The two refusals the reference logged are errors here, so the caller cannot
//! mistake a half-dropped database for an empty one.

use sqlx::postgres::PgConnection;

use crate::session::DedicatedConnection;

const DROP_SCHEMA_SQL: &str = "DROP SCHEMA public CASCADE";
const CREATE_SCHEMA_SQL: &str = "CREATE SCHEMA public";
const LIST_LARGE_OBJECTS_SQL: &str = "SELECT oid::bigint FROM pg_largeobject_metadata";
const UNLINK_LARGE_OBJECT_SQL: &str = "SELECT lo_unlink($1::oid)";

/// Why the database could not be emptied.
#[derive(Debug, thiserror::Error)]
pub enum DropError {
    /// The role does not own schema `public`, so it cannot drop it.
    #[error(
        "couldn't drop schema \"public\" as {username}: the role does not own it; as a database \
         superuser run ALTER SCHEMA public OWNER TO {username} and try again"
    )]
    Schema {
        /// The role the connection authenticated as.
        username: String,
        /// What the server refused.
        #[source]
        source: sqlx::Error,
    },
    /// The role cannot read the large-object catalogue.
    #[error(
        "couldn't list large objects as {username}: the role cannot read them; as a database \
         superuser run GRANT SELECT ON pg_largeobject TO {username} and try again"
    )]
    LargeObjects {
        /// The role the connection authenticated as.
        username: String,
        /// What the server refused.
        #[source]
        source: sqlx::Error,
    },
    /// Any other refusal, which is not a privilege the operator can grant.
    #[error(transparent)]
    Sql(#[from] sqlx::Error),
}

/// Drop schema `public`, recreate it, and unlink every large object.
pub async fn drop_db(connection: &mut DedicatedConnection) -> Result<(), DropError> {
    let username = connection.username().to_owned();
    let connection = connection.connection();

    drop_schema(connection, &username).await?;
    sqlx::query(CREATE_SCHEMA_SQL)
        .execute(&mut *connection)
        .await?;
    unlink_large_objects(connection, &username).await
}

async fn drop_schema(connection: &mut PgConnection, username: &str) -> Result<(), DropError> {
    match sqlx::query(DROP_SCHEMA_SQL).execute(&mut *connection).await {
        Ok(_) => Ok(()),
        Err(error) if is_insufficient_privilege(&error) => Err(DropError::Schema {
            username: username.to_owned(),
            source: error,
        }),
        Err(error) => Err(DropError::Sql(error)),
    }
}

async fn unlink_large_objects(
    connection: &mut PgConnection,
    username: &str,
) -> Result<(), DropError> {
    let oids = match sqlx::query_scalar::<_, i64>(LIST_LARGE_OBJECTS_SQL)
        .fetch_all(&mut *connection)
        .await
    {
        Ok(oids) => oids,
        Err(error) if is_insufficient_privilege(&error) => {
            return Err(DropError::LargeObjects {
                username: username.to_owned(),
                source: error,
            })
        }
        Err(error) => return Err(DropError::Sql(error)),
    };
    for oid in oids {
        sqlx::query(UNLINK_LARGE_OBJECT_SQL)
            .bind(oid)
            .execute(&mut *connection)
            .await?;
    }
    Ok(())
}

/// Whether the server refused for want of a privilege, the one case an operator can grant away.
fn is_insufficient_privilege(error: &sqlx::Error) -> bool {
    error
        .as_database_error()
        .and_then(|error| error.code())
        .is_some_and(|code| code.as_ref() == "42501")
}
