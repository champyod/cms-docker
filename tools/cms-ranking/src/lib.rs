pub mod config;
pub mod db;
pub mod http;
pub mod scoring;
pub mod store;

use std::sync::Arc;

pub use config::{ConfigError, RankingConfig};
pub use http::router;

#[derive(Clone)]
pub struct AppState {
    inner: Arc<AppStateInner>,
}

struct AppStateInner {
    db: Option<db::Db>,
}

impl AppState {
    pub fn new(db: Option<db::Db>) -> Self {
        Self {
            inner: Arc::new(AppStateInner { db }),
        }
    }

    pub fn without_db() -> Self {
        Self::new(None)
    }

    pub fn db(&self) -> Option<&db::Db> {
        self.inner.db.as_ref()
    }

    /// Reports whether the service can serve real ranking data. A missing
    /// database is not something a caller may paper over: every read route
    /// treats it as a refusal, so a misconfigured deployment shows nothing
    /// rather than an empty scoreboard.
    pub async fn is_ready(&self) -> bool {
        match self.db() {
            Some(db) => db.is_ready().await.is_ok(),
            None => false,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum StartupError {
    #[error(transparent)]
    Config(#[from] ConfigError),
    #[error("the database pool could not be created: {0}")]
    Database(#[from] sqlx::Error),
    #[error("the listener could not serve {address}: {source}")]
    Listen {
        address: std::net::SocketAddr,
        source: std::io::Error,
    },
}

pub async fn run() -> Result<(), StartupError> {
    let config = RankingConfig::from_env()?;
    let db = match config.database_url.as_deref() {
        Some(url) => Some(db::Db::connect_lazy(url)?),
        None => None,
    };
    let listener = tokio::net::TcpListener::bind(config.bind)
        .await
        .map_err(|source| StartupError::Listen {
            address: config.bind,
            source,
        })?;
    axum::serve(listener, router(AppState::new(db)))
        .await
        .map_err(|source| StartupError::Listen {
            address: config.bind,
            source,
        })
}
