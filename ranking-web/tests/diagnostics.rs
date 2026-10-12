//! The diagnostics route: the surface that makes the fold's forgiving path visible.
//!
//! WHY these are route tests and not fold tests: `skipped_overrides` and
//! `skipped_subchanges` were computed correctly for a long time and still reached
//! nobody, because no route served them. The unit behaviour was never the bug.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use cms_ranking::{router, AppState};
use tower::ServiceExt;

async fn status_of(uri: &str) -> StatusCode {
    let request = Request::builder()
        .uri(uri)
        .body(Body::empty())
        .expect("a well formed request");
    router(AppState::without_db())
        .oneshot(request)
        .await
        .expect("the router is infallible")
        .status()
}

/// Without a database the route refuses. It must not answer with zeros, because
/// "nothing was dropped" and "the store is unreadable" would then be indistinguishable
/// — the same reason every other read route refuses.
#[tokio::test]
async fn diagnostics_refuses_rather_than_reporting_zeros_without_a_database() {
    assert_eq!(
        status_of("/diagnostics").await,
        StatusCode::SERVICE_UNAVAILABLE
    );
}

/// The route is reachable at all, which is the regression: the counters existed with no
/// consumer, so a dropped override was invisible to an operator.
#[tokio::test]
async fn diagnostics_is_a_served_route_and_not_a_404() {
    let status = status_of("/diagnostics").await;
    assert_ne!(
        status,
        StatusCode::NOT_FOUND,
        "diagnostics must be registered on the router"
    );
}
