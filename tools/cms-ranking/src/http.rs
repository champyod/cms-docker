use axum::extract::State;
use axum::http::{HeaderValue, StatusCode};
use axum::response::{IntoResponse, Json, Response};
use axum::routing::get;
use axum::Router;
use serde::Serialize;

use crate::store::{load_appearance, load_ledger, Appearance};
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
    pub source_url: &'static str,
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

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(health))
        .route("/scores", get(scores))
        .route("/history", get(history))
        .route("/config", get(config))
        .fallback(unavailable)
        .with_state(state)
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

async fn scores(State(state): State<AppState>) -> Response {
    let Some(db) = state.db() else {
        return unavailable_json();
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
        Err(error) => {
            eprintln!("cms-ranking: /scores refused: {error}");
            unavailable_json()
        }
    }
}

async fn history(State(state): State<AppState>) -> Response {
    let Some(db) = state.db() else {
        return unavailable_json();
    };
    match load_ledger(db.pool()).await {
        Ok(ledger) => Json(ledger.history().to_vec()).into_response(),
        Err(error) => {
            eprintln!("cms-ranking: /history refused: {error}");
            unavailable_json()
        }
    }
}

async fn config(State(state): State<AppState>) -> Response {
    let appearance = match state.db() {
        Some(db) => match load_appearance(db.pool()).await {
            Ok(row) => row,
            Err(error) => {
                eprintln!("cms-ranking: /config refused: {error}");
                return unavailable_json();
            }
        },
        None => None,
    };
    Json(public_config(appearance)).into_response()
}

fn public_config(appearance: Option<Appearance>) -> PublicConfig {
    match appearance {
        Some(row) => PublicConfig {
            show_id_column: row.show_id_column(),
            source_url: DEFAULT_SOURCE_URL,
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
        },
        None => PublicConfig {
            show_id_column: false,
            source_url: DEFAULT_SOURCE_URL,
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
        },
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

fn unavailable_json() -> Response {
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
