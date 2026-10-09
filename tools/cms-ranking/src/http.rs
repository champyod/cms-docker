use axum::extract::Query;
use std::convert::Infallible;

use axum::extract::State;
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Json, Response};
use axum::routing::{any, get, post};
use axum::Router;
use serde::{Deserialize, Serialize};
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;
use tower_http::services::ServeDir;

use crate::store::{load_appearance, load_ledger, Appearance};
use crate::surface::{credits_from_file, logo_path, read_page, render_page};
use crate::AppState;

#[derive(Serialize)]
pub struct Health {
    pub status: &'static str,
}

/// The public configuration the vendored page fetches synchronously on load.
/// show_id_column and source_url keep their original meaning; the rest is the
/// appearance the panel now owns, additive so an older page ignores it.
#[derive(Serialize)]
pub struct PublicConfig {
    pub show_id_column: bool,
    pub source_url: String,
    pub title: Option<String>,
    pub subtitle: Option<String>,
    pub organisation: Option<String>,
    pub logo_asset: Option<String>,
    pub favicon_asset: Option<String>,
    pub theme: Option<serde_json::Value>,
    pub columns: Option<serde_json::Value>,
    pub score_format: Option<serde_json::Value>,
    pub footer_text: Option<String>,
    pub credits_text: Option<String>,
    pub access_mode: String,
}

/// Used when no appearance row exists yet: the AGPL source offer must still name
/// a deployment someone can reach.
const DEFAULT_SOURCE_URL: &str = "https://github.com/champyod/cms-docker";

/// Why the reason is a value and not a Response: clippy::result_large_err is right
/// that a Response in the Err slot makes every call site pay for the failure path.
pub(crate) struct Refusal(pub(crate) String);

impl Refusal {
    pub(crate) fn response(self) -> Response {
        refuse(&self.0)
    }
}

pub fn router(state: AppState) -> Router {
    let router = Router::new()
        .route("/healthz", get(health))
        .route("/login", get(crate::login::page).post(crate::login::submit))
        .route("/logout", post(crate::login::logout))
        .route("/", get(root))
        .route("/scores", get(scores))
        .route("/history", get(history))
        .route("/config", get(config))
        .route("/logo", get(logo))
        .route("/credits", get(credits))
        .route("/events", get(events));
    // One gate rather than the same check in five handlers, and it reads access_mode
    // from the row /config serves, so a panel change applies on the next request.
    let router = router.layer(axum::middleware::from_fn_with_state(
        state.clone(),
        crate::login::gate,
    ));
    match state.config().static_dir.clone() {
        // The vendored page asks for its stylesheet, scripts and images by name at
        // the root, so the directory is the fallback rather than one route.
        Some(directory) => router
            .fallback_service(ServeDir::new(directory).fallback(any(unavailable)))
            .with_state(state),
        None => router.fallback(unavailable).with_state(state),
    }
}

async fn health(State(state): State<AppState>) -> (StatusCode, Json<Health>) {
    if state.is_ready().await {
        (StatusCode::OK, Json(Health { status: "ok" }))
    } else {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(Health {
                status: "unavailable",
            }),
        )
    }
}

async fn root(State(state): State<AppState>) -> Response {
    let Some(directory) = state.config().static_dir.as_ref() else {
        return refuse("no RANKING_STATIC_DIR is configured");
    };
    let appearance = match appearance_of(&state).await {
        Ok(appearance) => appearance,
        Err(refusal) => return refusal.response(),
    };
    match read_page(&directory.join("Ranking.html")) {
        Ok(html) => html_response(&render_page(&html, appearance.as_ref())),
        Err(error) => refuse(&error.to_string()),
    }
}

async fn scores(State(state): State<AppState>) -> Response {
    let Some(db) = state.db() else {
        return refuse("no database is configured");
    };
    match load_ledger(db.pool()).await {
        Ok(ledger) => {
            let mut response = Json(ledger.scores().clone()).into_response();
            if let Ok(timestamp) = HeaderValue::from_str(&now_stamp()) {
                response.headers_mut().insert("Timestamp", timestamp);
            }
            response
        }
        // A refusal, never a partial or empty board: a page that renders an empty
        // scoreboard during a contest is worse than one that renders an error.
        Err(error) => refuse(&error.to_string()),
    }
}

async fn history(State(state): State<AppState>) -> Response {
    let Some(db) = state.db() else {
        return refuse("no database is configured");
    };
    match load_ledger(db.pool()).await {
        Ok(ledger) => Json(ledger.history().to_vec()).into_response(),
        Err(error) => refuse(&error.to_string()),
    }
}

async fn config(State(state): State<AppState>) -> Response {
    let appearance = match appearance_of(&state).await {
        Ok(appearance) => appearance,
        Err(refusal) => return refusal.response(),
    };
    Json(public_config(appearance)).into_response()
}

async fn logo(State(state): State<AppState>) -> Response {
    let Some(directory) = state.config().static_dir.as_ref() else {
        return refuse("no RANKING_STATIC_DIR is configured");
    };
    let appearance = match appearance_of(&state).await {
        Ok(appearance) => appearance,
        Err(refusal) => return refusal.response(),
    };
    let path = logo_path(
        appearance.as_ref(),
        state.config().logo_path.as_deref(),
        directory,
    );
    match tokio::fs::read(&path).await {
        Ok(bytes) => ([(header::CONTENT_TYPE, content_type_for(&path))], bytes).into_response(),
        Err(error) => refuse(&format!("{}: {error}", path.display())),
    }
}

async fn credits(State(state): State<AppState>) -> Response {
    let appearance = match appearance_of(&state).await {
        Ok(appearance) => appearance,
        Err(refusal) => return refusal.response(),
    };
    let text = appearance.and_then(|row| row.credits_text);
    let Some(path) = state.config().credits_file.as_ref() else {
        return refuse("no credits file is configured");
    };
    match credits_from_file(path, text) {
        Ok(credits) => Json(credits).into_response(),
        Err(error) => refuse(&error.to_string()),
    }
}

#[derive(Deserialize)]
pub struct EventsQuery {
    pub last_event_id: Option<String>,
}

/// The live stream. A client that names a last event id gets the events it missed,
/// or a reinit when the gap is wider than the cache, which is what the Python
/// server did; a subscriber that falls behind gets a reinit too, because it can no
/// longer be told what it missed.
async fn events(State(state): State<AppState>, Query(query): Query<EventsQuery>) -> Response {
    let feed = state.feed().clone();
    let receiver = feed.subscribe();
    // axum's Sse takes a stream of Results so a producer error can end the stream;
    // nothing here fails, so every item is Ok.
    let opening: Vec<Result<Event, Infallible>> = match feed.since(query.last_event_id.as_deref()) {
        Some(events) => events
            .into_iter()
            .map(|event| Ok(to_event(event)))
            .collect(),
        None => vec![Ok(Event::default().event("reinit"))],
    };
    let live = BroadcastStream::new(receiver).map(|result| match result {
        Ok(event) => Ok(to_event(event)),
        Err(_) => Ok(Event::default().event("reinit")),
    });
    let stream = tokio_stream::iter(opening).chain(live);
    Sse::new(stream)
        .keep_alive(
            KeepAlive::new()
                .interval(std::time::Duration::from_secs(15))
                .text("keep-alive"),
        )
        .into_response()
}

fn to_event(event: crate::feed::RankingEvent) -> Event {
    Event::default()
        .id(event.id)
        .event(event.name)
        .data(event.data)
}

/// Resolves the appearance, or the refusal the caller must return. The database is
/// required here too: a page rendered without it would show a board with no scores
/// and no way to tell why.
async fn appearance_of(state: &AppState) -> Result<Option<Appearance>, Refusal> {
    let Some(db) = state.db() else {
        return Err(Refusal("no database is configured".to_string()));
    };
    load_appearance(db.pool())
        .await
        .map_err(|error| Refusal(error.to_string()))
}

fn public_config(appearance: Option<Appearance>) -> PublicConfig {
    let Some(row) = appearance else {
        return PublicConfig {
            show_id_column: false,
            source_url: DEFAULT_SOURCE_URL.to_string(),
            title: None,
            subtitle: None,
            organisation: None,
            logo_asset: None,
            favicon_asset: None,
            theme: None,
            columns: None,
            score_format: None,
            footer_text: None,
            credits_text: None,
            access_mode: "public".to_string(),
        };
    };
    PublicConfig {
        show_id_column: row.show_id_column(),
        source_url: DEFAULT_SOURCE_URL.to_string(),
        title: row.title,
        subtitle: row.subtitle,
        organisation: row.organisation,
        logo_asset: row.logo_asset,
        favicon_asset: row.favicon_asset,
        theme: row.theme,
        columns: row.columns,
        score_format: row.score_format,
        footer_text: row.footer_text,
        credits_text: row.credits_text,
        access_mode: row.access_mode,
    }
}

fn content_type_for(path: &std::path::Path) -> &'static str {
    match path.extension().and_then(std::ffi::OsStr::to_str) {
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("bmp") => "image/bmp",
        _ => "image/png",
    }
}

/// The Python server sends this as "%0.6f" seconds since the epoch; the page
/// compares it against its own clock to show how stale the board is.
fn now_stamp() -> String {
    match std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH) {
        Ok(elapsed) => format!("{}.{:06}", elapsed.as_secs(), elapsed.subsec_micros()),
        Err(_) => "0.000000".to_string(),
    }
}

fn html_response(html: &str) -> Response {
    (
        [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
        html.to_string(),
    )
        .into_response()
}

pub(crate) fn refuse(reason: &str) -> Response {
    eprintln!("cms-ranking: refused: {reason}");
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(Health {
            status: "unavailable",
        }),
    )
        .into_response()
}

/// Every route the Python service exposes that is still unimplemented refuses
/// instead of answering with a body a page would render as an empty scoreboard.
async fn unavailable() -> (StatusCode, Json<Health>) {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(Health {
            status: "unavailable",
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn appearance(columns: Option<serde_json::Value>, access_mode: &str) -> Appearance {
        Appearance {
            title: Some("IOI 2026".to_string()),
            subtitle: Some("Day 2".to_string()),
            organisation: None,
            logo_asset: None,
            favicon_asset: None,
            theme: Some(serde_json::json!({ "accent": "#00A3DA" })),
            columns,
            score_format: None,
            footer_text: Some("footer".to_string()),
            credits_text: Some("credits".to_string()),
            access_mode: access_mode.to_string(),
        }
    }

    /// What the panel writes has to arrive at the page, because /config is the only
    /// channel it has: the vendored page reads it before it draws anything.
    #[test]
    fn the_panel_row_reaches_the_page() {
        let columns = Some(serde_json::json!({ "show_id_column": true }));
        let published = public_config(Some(appearance(columns, "protected")));
        assert_eq!(published.title.as_deref(), Some("IOI 2026"));
        assert_eq!(published.subtitle.as_deref(), Some("Day 2"));
        assert_eq!(published.access_mode, "protected");
        assert_eq!(published.footer_text.as_deref(), Some("footer"));
        assert!(published.show_id_column);
    }

    /// A row that does not exist yet must publish the documented defaults rather than
    /// nothing: the page falls back to the vendored behaviour only if it can read them.
    #[test]
    fn a_missing_row_publishes_the_defaults() {
        let published = public_config(None);
        assert!(!published.show_id_column);
        assert_eq!(published.access_mode, "public");
        assert!(published.title.is_none());
        assert_eq!(published.source_url, DEFAULT_SOURCE_URL);
    }

    /// The id column is a privacy switch, so only a real boolean turns it on: a string
    /// or a number from a hand-edited row must leave it off.
    #[test]
    fn the_id_column_needs_a_real_boolean() {
        for columns in [
            serde_json::json!({ "show_id_column": "true" }),
            serde_json::json!({ "show_id_column": 1 }),
            serde_json::json!({}),
        ] {
            let published = public_config(Some(appearance(Some(columns), "public")));
            assert!(
                !published.show_id_column,
                "a mistyped value must not show ids"
            );
        }
    }
}
