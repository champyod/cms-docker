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
/// is the proxy, so a forwarded header is the only address that means anything.
///
/// WHY the last hop and never the first: a vhost that appends to X-Forwarded-For
/// keeps whatever the caller sent in front of the address our own proxy wrote, so
/// the leftmost entry is caller-supplied and would let a caller choose its own
/// lockout bucket. The rightmost entry is the hop the nearest proxy appended, and
/// X-Real-IP is the address every vhost asserts from $remote_addr for the same
/// request, which covers a path that carries no chain. Only a request with neither
/// header has no caller to name.
pub fn client_address(headers: &HeaderMap) -> String {
    for value in [headers.get("x-forwarded-for"), headers.get("x-real-ip")]
        .into_iter()
        .flatten()
        .filter_map(|value| value.to_str().ok())
    {
        if let Some(hop) = value.split(',').rev().find_map(|hop| {
            let hop = hop.trim();
            (!hop.is_empty()).then_some(hop)
        }) {
            return hop.to_string();
        }
    }
    "unknown".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn headers_of(entries: &[(&str, &str)]) -> HeaderMap {
        let mut headers = HeaderMap::new();
        for (name, value) in entries {
            let name = name
                .parse::<axum::http::HeaderName>()
                .expect("a header name");
            headers.insert(name, value.parse().expect("a header value"));
        }
        headers
    }

    #[test]
    fn the_last_hop_is_the_address_and_the_first_is_never_trusted() {
        let headers = headers_of(&[("x-forwarded-for", "1.2.3.4, 198.51.100.9")]);
        assert_eq!(client_address(&headers), "198.51.100.9");
    }

    #[test]
    fn an_empty_trailing_hop_skips_back_to_the_asserted_one() {
        let headers = headers_of(&[("x-forwarded-for", "203.0.113.7, ")]);
        assert_eq!(client_address(&headers), "203.0.113.7");
    }

    #[test]
    fn a_path_with_no_chain_falls_back_to_the_real_address() {
        let headers = headers_of(&[("x-real-ip", "203.0.113.7")]);
        assert_eq!(client_address(&headers), "203.0.113.7");
    }

    #[test]
    fn a_request_no_proxy_spoke_for_has_no_address_to_share() {
        assert_eq!(client_address(&HeaderMap::new()), "unknown");
    }
}
