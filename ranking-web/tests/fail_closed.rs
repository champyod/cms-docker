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
