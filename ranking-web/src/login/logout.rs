use axum::http::header;
use axum::response::{IntoResponse, Redirect, Response};

use crate::auth::session;

pub async fn logout() -> Response {
    let mut response = Redirect::to("/login").into_response();
    if let Ok(value) = session::clear_cookie().parse() {
        response.headers_mut().append(header::SET_COOKIE, value);
    }
    response
}
