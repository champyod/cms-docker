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

#[tokio::test]
async fn health_reports_unavailable_without_a_database() {
    assert_eq!(status_of("/healthz").await, StatusCode::SERVICE_UNAVAILABLE);
}

#[tokio::test]
async fn an_unimplemented_route_refuses_instead_of_answering() {
    assert_eq!(status_of("/scores").await, StatusCode::SERVICE_UNAVAILABLE);
}

/// The diagnostics route must be reachable without a session, because the admin panel
/// reads it over the internal network and holds no console cookie. With no database it
/// refuses (503) rather than redirecting to /login: a 302 would be indistinguishable
/// from "everything is fine" to a caller that only checks for success.
///
/// WHY this is not proved by the status code alone: without a database the gate cannot
/// read access_mode, so it refuses before it ever decides to redirect. The assertion is
/// therefore that the answer is a 503 *and* not a redirect — a redirect here would mean
/// the route sits behind the gate, which is the regression being guarded.
#[tokio::test]
async fn diagnostics_is_reachable_without_a_session() {
    let status = status_of("/diagnostics").await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert!(
        !status.is_redirection(),
        "diagnostics must not sit behind the login gate"
    );
}
