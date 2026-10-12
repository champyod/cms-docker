use axum::extract::{Request, State};
use axum::http::HeaderMap;
use axum::middleware::Next;
use axum::response::{IntoResponse, Redirect, Response};

use crate::auth::session;
use crate::http::refuse;
use crate::store::load_appearance;
use crate::AppState;

/// The protected-mode gate. It runs before every route except the four an anonymous
/// caller must reach, and it reads access_mode from the same row /config serves, so a
/// panel change takes effect on the next request rather than on the next deploy.
pub async fn gate(State(state): State<AppState>, request: Request, next: Next) -> Response {
    let path = request.uri().path().to_string();
    // WHY /diagnostics is exempt beside /healthz: both are operator-facing health
    // surfaces, not scoreboard data. The admin panel reads this over the internal
    // network to show a dropped-override warning, and it carries no session cookie —
    // so under protected mode a gated /diagnostics would answer 302 and the panel
    // could not tell "no rows dropped" from "refused". It exposes only three
    // integers, the same class of fact /healthz already serves.
    if matches!(
        path.as_str(),
        "/healthz" | "/diagnostics" | "/login" | "/logout"
    ) {
        return next.run(request).await;
    }
    let Some(db) = state.db() else {
        return refuse("no database is configured");
    };
    let appearance = match load_appearance(db.pool()).await {
        Ok(row) => row,
        Err(error) => return refuse(&error.to_string()),
    };
    let protected = appearance
        .as_ref()
        .is_some_and(|row| row.access_mode == "protected");
    if !protected {
        return next.run(request).await;
    }
    let session =
        session::from_headers(state.config().session_secret.as_deref(), request.headers());
    if session.is_some() {
        return next.run(request).await;
    }
    Redirect::to("/login").into_response()
}

/// The client address the counters are scoped to. Behind the domain proxy the socket
/// is the proxy, so the forwarded header is the only address that means anything.
pub fn client_address(headers: &HeaderMap) -> String {
    for name in ["x-forwarded-for", "x-real-ip"] {
        if let Some(value) = headers.get(name).and_then(|value| value.to_str().ok()) {
            let first = value.split(',').next().unwrap_or_default().trim();
            if !first.is_empty() {
                return first.to_string();
            }
        }
    }
    "unknown".to_string()
}
