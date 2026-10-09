use sqlx::postgres::{PgPool, PgPoolOptions};

#[derive(Clone)]
pub struct Db {
    pool: PgPool,
}

impl Db {
    /// Builds a pool without connecting. The service starts even when the
    /// database is down, so an operator sees a refusal on /healthz instead of
    /// a crash loop that says nothing about what is missing.
    pub fn connect_lazy(database_url: &str) -> Result<Self, sqlx::Error> {
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect_lazy(database_url)?;
        Ok(Self { pool })
    }

    pub async fn is_ready(&self) -> Result<(), sqlx::Error> {
        sqlx::query("SELECT 1")
            .fetch_one(&self.pool)
            .await
            .map(|_| ())
    }
}
