use axum::extract::State;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Json, Response};
use axum::routing::{any, get, post};
use axum::Router;
use serde::Serialize;
use tower_http::services::ServeDir;

use crate::board;
use crate::json::{json_response, stamped_json};
use crate::public_config::public_config;
use crate::store::{load_appearance, Appearance};
use crate::surface::{credits_from_file, logo_path, render_page};
use crate::AppState;

#[derive(Serialize)]
pub struct Health {
    pub status: &'static str,
}

/// What the service actually applied, for the panel to show.
///
/// WHY this exists: the fold is deliberately forgiving — an unreadable override or a
/// subchange that resolves to no known submission is dropped and counted rather than
/// refusing the whole board. That is the right call, but until now the counters were
/// computed and thrown away, so a dropped override looked exactly like a board that
/// had none. This is the surface that makes the forgiving path visible.
#[derive(Serialize)]
pub struct Diagnostics {
    pub ready: bool,
    pub skipped_overrides: usize,
    pub skipped_subchanges: usize,
}

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
        .route("/diagnostics", get(diagnostics))
        .route("/login", get(crate::login::page).post(crate::login::submit))
        .route("/logout", post(crate::login::logout))
        .route("/", get(root))
        .route("/scores", get(scores))
        .route("/board", get(board))
        .route("/board/teams", get(board_teams))
        .route("/history", get(history))
        .route("/overrides", get(overrides))
        .route("/config", get(config))
        .route("/logo", get(logo))
        .route("/credits", get(credits))
        .route("/events", get(crate::events::events));
    let router = crate::entity_routes::routes(router);
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
    // The page itself is a template now, but its stylesheet and scripts still come
    // from this directory, so a deployment with none refuses rather than serving a
    // bare document nothing can draw with.
    if state.config().static_dir.is_none() {
        return refuse("no RANKING_STATIC_DIR is configured");
    }
    let appearance = match appearance_of(&state).await {
        Ok(appearance) => appearance,
        Err(refusal) => return refusal.response(),
    };
    match render_page(appearance.as_ref()) {
        Ok(html) => html_response(&html),
        Err(error) => refuse(&error.to_string()),
    }
}

async fn scores(State(state): State<AppState>) -> Response {
    // A refusal, never a partial or empty board: a page that renders an empty
    // scoreboard during a contest is worse than one that renders an error.
    match state.standings().await {
        Ok(standings) => stamped_json(standings.ledger.scores()),
        Err(error) => refuse(&error.to_string()),
    }
}

/// The board the page draws: one entry per visible user, override-applied and ranked
/// by the server, so a rename, a hide, a guest, a score or a pin reaches the reader
/// without the client recomputing anything.
async fn board(State(state): State<AppState>) -> Response {
    match state.standings().await {
        Ok(standings) => stamped_json(&board::board_view(
            standings.ledger.board(),
            &standings.users,
        )),
        Err(error) => refuse(&error.to_string()),
    }
}

/// The team board: each team's visible members summed, with the team-level overrides
/// applied to the aggregate rather than to each member.
async fn board_teams(State(state): State<AppState>) -> Response {
    match state.standings().await {
        Ok(standings) => stamped_json(&board::team_board_view(
            standings.ledger.board(),
            &standings.users,
            &standings.team_names,
            &standings.overrides,
        )),
        Err(error) => refuse(&error.to_string()),
    }
}

async fn history(State(state): State<AppState>) -> Response {
    match state.standings().await {
        Ok(standings) => json_response(&standings.ledger.history().to_vec()),
        Err(error) => refuse(&error.to_string()),
    }
}

async fn overrides(State(state): State<AppState>) -> Response {
    let Some(db) = state.db() else {
        return refuse("no database is configured");
    };
    match crate::overrides::load_overrides(db.pool(), state.config().contest_id).await {
        Ok(rows) => json_response(&rows),
        Err(error) => refuse(&error.to_string()),
    }
}

async fn config(State(state): State<AppState>) -> Response {
    let appearance = match appearance_of(&state).await {
        Ok(appearance) => appearance,
        Err(refusal) => return refusal.response(),
    };
    json_response(&public_config(appearance))
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
    let panel_list = appearance.as_ref().and_then(|row| row.credits.clone());
    let Some(path) = state.config().credits_file.as_ref() else {
        return refuse("no credits file is configured");
    };
    match credits_from_file(path, panel_list) {
        Ok(credits) => json_response(&credits),
        Err(error) => refuse(&error.to_string()),
    }
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

async fn diagnostics(State(state): State<AppState>) -> Response {
    // A refusal, never zeros: "no database" and "nothing was dropped" must not look
    // alike, which is the same reason every other read route refuses here.
    match state.standings().await {
        Ok(standings) => json_response(&Diagnostics {
            ready: true,
            skipped_overrides: standings.ledger.skipped_overrides(),
            skipped_subchanges: standings.ledger.skipped_subchanges(),
        }),
        Err(error) => refuse(&error.to_string()),
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

/// An entity that the projection does not hold. It is a refusal of the request, not
/// of the service, so it is a 404 rather than the 503 a missing database gets.
pub(crate) fn not_found() -> Response {
    StatusCode::NOT_FOUND.into_response()
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
