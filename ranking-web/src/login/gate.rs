use std::net::IpAddr;

use axum::extract::{Request, State};
use axum::http::HeaderMap;
use axum::middleware::Next;
use axum::response::{IntoResponse, Redirect, Response};

use crate::auth::session;
use crate::http::refuse;
use crate::store::{load_appearance, sessions};
use crate::trusted_proxy::{canonical_address, is_trusted_proxy, TrustedProxy};
use crate::AppState;

/// The protected-mode gate. It runs before every route except the four an anonymous
/// caller must reach, and it reads access_mode from the same row /config serves, so a
/// panel change takes effect on the next request rather than on the next deploy.
pub async fn gate(State(state): State<AppState>, request: Request, next: Next) -> Response {
    let path = request.uri().path().to_string();
    // /healthz and /diagnostics are operator health surfaces, not scoreboard data.
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
    let Some(session) =
        session::from_headers(state.config().session_secret.as_deref(), request.headers())
    else {
        return Redirect::to("/login").into_response();
    };
    let Some(db) = state.db() else {
        return refuse("no database is configured");
    };
    match sessions::is_live(db.pool(), &session.session_id, &session.username).await {
        Ok(true) => next.run(request).await,
        Ok(false) => Redirect::to("/login").into_response(),
        Err(error) => refuse(&error.to_string()),
    }
}

/// The client address the counters are scoped to.
///
/// A forwarded header is read only when the socket peer is in `trusted_proxies`;
/// an untrusted caller always contributes its peer address, so it cannot choose a
/// bucket by supplying a header. The rightmost non-empty hop is the one the nearest
/// proxy appended; a malformed header falls back to the peer rather than an earlier
/// caller-supplied entry.
pub fn client_address(
    headers: &HeaderMap,
    peer: IpAddr,
    trusted_proxies: &[TrustedProxy],
) -> String {
    let peer = canonical_address(peer);
    if !is_trusted_proxy(peer, trusted_proxies) {
        return peer.to_string();
    }
    forwarded_address(headers)
        .map(canonical_address)
        .unwrap_or(peer)
        .to_string()
}

fn forwarded_address(headers: &HeaderMap) -> Option<IpAddr> {
    for value in [headers.get("x-forwarded-for"), headers.get("x-real-ip")]
        .into_iter()
        .flatten()
        .filter_map(|value| value.to_str().ok())
    {
        if let Some(address) = value
            .split(',')
            .rev()
            .map(str::trim)
            .find(|hop| !hop.is_empty())
            .and_then(|hop| hop.parse::<IpAddr>().ok())
        {
            return Some(address);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::trusted_proxy::parse_proxy_list;

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

    fn address(raw: &str) -> IpAddr {
        raw.parse().expect("a literal address")
    }

    fn proxies(raw: &[&str]) -> Vec<TrustedProxy> {
        raw.iter()
            .map(|entry| TrustedProxy::parse(entry).expect("a proxy network"))
            .collect()
    }

    #[test]
    fn an_untrusted_peer_cannot_choose_its_bucket() {
        let headers = headers_of(&[("x-forwarded-for", "198.51.100.7")]);
        assert_eq!(
            client_address(
                &headers,
                address("203.0.113.9"),
                &proxies(&["198.51.100.0/24"])
            ),
            "203.0.113.9"
        );
    }

    #[test]
    fn a_trusted_peer_uses_the_last_hop_and_never_the_first() {
        let headers = headers_of(&[("x-forwarded-for", "1.2.3.4, 203.0.113.7")]);
        assert_eq!(
            client_address(
                &headers,
                address("198.51.100.9"),
                &proxies(&["198.51.100.0/24"])
            ),
            "203.0.113.7"
        );
    }

    #[test]
    fn an_empty_trailing_hop_skips_back_to_the_asserted_one() {
        let headers = headers_of(&[("x-forwarded-for", "203.0.113.7, ")]);
        assert_eq!(
            client_address(
                &headers,
                address("198.51.100.9"),
                &proxies(&["198.51.100.0/24"])
            ),
            "203.0.113.7"
        );
    }

    #[test]
    fn a_trusted_path_with_no_chain_falls_back_to_the_real_address() {
        let headers = headers_of(&[("x-real-ip", "203.0.113.7")]);
        assert_eq!(
            client_address(
                &headers,
                address("198.51.100.9"),
                &proxies(&["198.51.100.0/24"])
            ),
            "203.0.113.7"
        );
    }

    #[test]
    fn a_trusted_peer_without_a_header_uses_its_own_address() {
        assert_eq!(
            client_address(
                &HeaderMap::new(),
                address("198.51.100.9"),
                &proxies(&["198.51.100.0/24"])
            ),
            "198.51.100.9"
        );
    }

    #[test]
    fn a_malformed_nearest_hop_never_falls_back_to_a_caller_entry() {
        let headers = headers_of(&[("x-forwarded-for", "203.0.113.7, garbage")]);
        assert_eq!(
            client_address(
                &headers,
                address("198.51.100.9"),
                &proxies(&["198.51.100.0/24"])
            ),
            "198.51.100.9"
        );
    }

    #[test]
    fn a_mapped_peer_keeps_one_bucket_with_its_v4_address() {
        assert_eq!(
            client_address(
                &HeaderMap::new(),
                address("::ffff:198.51.100.9"),
                &proxies(&["198.51.100.0/24"]),
            ),
            "198.51.100.9"
        );
    }

    #[test]
    fn a_list_of_networks_is_read_once() {
        assert_eq!(
            parse_proxy_list("198.51.100.0/24, 2001:db8::/32")
                .expect("a list")
                .len(),
            2
        );
    }
}
