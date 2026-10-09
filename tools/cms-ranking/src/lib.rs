pub mod auth;
pub mod config;
pub mod db;
pub mod feed;
pub mod http;
pub mod login;
pub mod scoring;
pub mod store;
pub mod surface;

use std::sync::Arc;

pub use config::{ConfigError, RankingConfig};
pub use feed::Feed;
pub use http::router;

#[derive(Clone)]
pub struct AppState {
    inner: Arc<AppStateInner>,
}

struct AppStateInner {
    db: Option<db::Db>,
    config: RankingConfig,
    feed: Feed,
    counter: Option<auth::counter::Counter>,
    http: reqwest::Client,
}

impl AppState {
    pub fn new(
        db: Option<db::Db>,
        config: RankingConfig,
        counter: Option<auth::counter::Counter>,
    ) -> Self {
        Self {
            inner: Arc::new(AppStateInner {
                db,
                config,
                feed: Feed::new(),
                counter,
                http: reqwest::Client::new(),
            }),
        }
    }

    /// For the tests that exercise the refusals: no database, no counters, whatever
    /// the environment happens to hold.
    pub fn without_db() -> Self {
        Self::new(None, RankingConfig::from_env().unwrap_or_default(), None)
    }

    pub fn db(&self) -> Option<&db::Db> {
        self.inner.db.as_ref()
    }

    pub fn config(&self) -> &RankingConfig {
        &self.inner.config
    }

    pub fn feed(&self) -> &Feed {
        &self.inner.feed
    }

    pub fn counter(&self) -> Option<&auth::counter::Counter> {
        self.inner.counter.as_ref()
    }

    pub fn http(&self) -> &reqwest::Client {
        &self.inner.http
    }

    /// Reports whether the service can serve real ranking data. A missing database is
    /// not something a caller may paper over: every read route treats it as a refusal,
    /// so a misconfigured deployment shows nothing rather than an empty scoreboard.
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
    // A console with no counters cannot refuse a repeated failure, and the login route
    // treats that as a refusal rather than as an unguarded door.
    let counter = match config.redis_url.as_deref() {
        Some(url) => match auth::counter::Counter::connect(url).await {
            Ok(counter) => Some(counter),
            Err(error) => {
                eprintln!("cms-ranking: failure counters unavailable: {error}");
                None
            }
        },
        None => None,
    };
    let state = AppState::new(db, config.clone(), counter);
    // The listener runs for the process lifetime: without it the board only changes
    // when a browser reloads, which is the behaviour Slice 4 exists to remove.
    if let Some(database) = state.db().cloned() {
        let feed = state.feed().clone();
        tokio::spawn(async move { feed::listen(database, feed).await });
    }
    let listener = tokio::net::TcpListener::bind(config.bind)
        .await
        .map_err(|source| StartupError::Listen {
            address: config.bind,
            source,
        })?;
    axum::serve(listener, router(state))
        .await
        .map_err(|source| StartupError::Listen {
            address: config.bind,
            source,
        })
}
