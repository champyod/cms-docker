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
use crate::store::{
    load_appearance, load_contest, load_shown_set, Appearance, RankingContest, ShownSet,
};
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
    /// Every row the fold dropped, so the board's missing rows have one number. The three
    /// causes below partition it — the meaning this key already had, so the panel's consumer
    /// reads what it always read.
    pub skipped_subchanges: usize,
    /// The dropped rows whose task a task or contest hide removed: the operator's own doing, and
    /// no alarm. Split out of `skipped_subchanges`, which used to count a hidden contest's
    /// submissions as data faults (466 on prod) while exempting a hidden task's.
    pub hidden_task_subchanges: usize,
    /// The dropped rows whose task no drawn task of the projection carries: the push never
    /// announced it, or it belongs to a contest this instance does not draw. Chase this one.
    pub unknown_task_subchanges: usize,
    /// The dropped subchange rows whose submission the projection does not hold. Chase this one.
    pub orphan_subchanges: usize,
    /// Task hides that named no task row: the hide exists but drops nothing, so a renamed
    /// task silently stops being hidden. It is the three causes below, summed — the meaning
    /// this key already had, so the panel's consumer reads what it always read.
    pub unknown_task_hides: usize,
    /// The task hides whose contest the projection holds with no task of it: the push
    /// announced the contest with an empty task set (its task had no active dataset), so the
    /// CMS knows the task and the projection withholds it. Split out of `unknown_task_hides`,
    /// which raised it as a rename alarm forever.
    pub withheld_task_hides: usize,
    /// The task hides naming a task a live contest no longer holds: the stale key a rename
    /// leaves, which is the alarm the counter exists for.
    pub renamed_task_hides: usize,
    /// The task hides naming neither a projected contest nor a projected task: nothing in the
    /// snapshot explains the key.
    pub unmatched_task_hides: usize,
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
    let shown = match shown_of(&state).await {
        Ok(shown) => shown,
        Err(refusal) => return refusal.response(),
    };
    let contest = match contest_of(&state, &shown).await {
        Ok(contest) => contest,
        Err(refusal) => return refusal.response(),
    };
    match render_page(appearance.as_ref(), &shown, contest.as_ref()) {
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
    let shown = match shown_of(&state).await {
        Ok(shown) => shown,
        Err(refusal) => return refusal.response(),
    };
    match crate::overrides::load_overrides(db.pool(), shown.contest_ids()).await {
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

/// What the board is told to show, or the refusal the caller must return.
///
/// WHY the database is required: the shown set is the board's whole answer for its contents, so a
/// read that could not reach it would have to guess what to draw.
async fn shown_of(state: &AppState) -> Result<ShownSet, Refusal> {
    let Some(db) = state.db() else {
        return Err(Refusal("no database is configured".to_string()));
    };
    let served = state
        .served_contest()
        .await
        .map_err(|error| Refusal(error.to_string()))?;
    load_shown_set(db.pool(), served)
        .await
        .map_err(|error| Refusal(error.to_string()))
}

/// The contest the board shows, or None when the config shows none or several, or the projection
/// holds no record for it yet.
///
/// WHY a missing record is not a refusal: the push may not have carried the contest's id yet, and
/// the page can still serve the board. It renders the default title rather than a heading that
/// might describe another day.
async fn contest_of(state: &AppState, shown: &ShownSet) -> Result<Option<RankingContest>, Refusal> {
    let Some(contest_id) = shown.sole_contest() else {
        return Ok(None);
    };
    let Some(db) = state.db() else {
        return Err(Refusal("no database is configured".to_string()));
    };
    load_contest(db.pool(), contest_id)
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
            hidden_task_subchanges: standings.ledger.hidden_task_subchanges(),
            unknown_task_subchanges: standings.ledger.unknown_task_subchanges(),
            orphan_subchanges: standings.ledger.orphan_subchanges(),
            unknown_task_hides: standings.ledger.unknown_task_hides(),
            withheld_task_hides: standings.ledger.withheld_task_hides(),
            renamed_task_hides: standings.ledger.renamed_task_hides(),
            unmatched_task_hides: standings.ledger.unmatched_task_hides(),
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
