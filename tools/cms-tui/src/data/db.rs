//! Postgres connectivity + row-count collector.

use std::time::Duration;

use tokio_postgres::NoTls;

use crate::data::env;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct DbStats {
    pub healthy: bool,
    pub contests: i64,
    pub users: i64,
    pub teams: i64,
}

const CONNECT_TIMEOUT_SECS: u64 = 3;

/// Connects to localhost Postgres using .env.core credentials.
/// Any failure yields unhealthy zero stats instead of an error.
pub async fn stats() -> DbStats {
    let Some(conn_str) = connection_string() else {
        return DbStats::default();
    };
    query_counts(&conn_str).await.unwrap_or_default()
}

fn connection_string() -> Option<String> {
    let values = env::parse(&env::repo_root().join(env::CORE_ENV_FILE));
    let user = values.get("POSTGRES_USER")?;
    let password = values.get("POSTGRES_PASSWORD")?;
    let dbname = values.get("POSTGRES_DB")?;
    let port = values
        .get("POSTGRES_PORT_EXTERNAL")
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(5432);
    Some(format!(
        "host=localhost port={port} user={user} password={password} \
         dbname={dbname} connect_timeout={CONNECT_TIMEOUT_SECS}"
    ))
}

async fn query_counts(conn_str: &str) -> anyhow::Result<DbStats> {
    let connect = tokio_postgres::connect(conn_str, NoTls);
    let (client, connection) =
        tokio::time::timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS), connect).await??;
    tokio::spawn(connection);
    Ok(DbStats {
        healthy: true,
        contests: count(&client, "contests").await?,
        users: count(&client, "users").await?,
        teams: count(&client, "teams").await?,
    })
}

async fn count(client: &tokio_postgres::Client, table: &str) -> anyhow::Result<i64> {
    let sql = format!("select count(*) from {table}");
    let row = client.query_one(sql.as_str(), &[]).await?;
    Ok(row.get::<_, i64>(0))
}
