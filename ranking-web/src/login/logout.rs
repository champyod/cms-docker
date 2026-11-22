use axum::extract::State;
use axum::http::header;
use axum::http::HeaderMap;
use axum::response::{IntoResponse, Redirect, Response};

use crate::auth::session;
use crate::store::sessions;
use crate::AppState;

pub async fn logout(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let (Some(session), Some(db)) = (
        session::from_headers(state.config().session_secret.as_deref(), &headers),
        state.db(),
    ) {
        // WHY ignore the delete error: the cookie is cleared regardless; a database outage
        // must not keep the browser presenting a token it can no longer use.
        let _ = sessions::delete(db.pool(), &session.session_id).await;
    }
    let mut response = Redirect::to("/login").into_response();
    if let Ok(value) = session::clear_cookie().parse() {
        response.headers_mut().append(header::SET_COOKIE, value);
    }
    response
}
