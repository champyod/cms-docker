//! The contestant-face route against a directory of uploads, without a database: the
//! route reads the file itself and falls back to the bundled dummy, so the projection
//! it would otherwise consult is not involved and these tests run everywhere.

use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use cms_ranking::config::RankingConfig;
use cms_ranking::AppState;
use tower::ServiceExt;

/// The vendored page's image directory, so the bundled fallback resolves in tests.
fn static_dir() -> std::path::PathBuf {
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../src/cmsranking/static")
}

fn dummy_face() -> Vec<u8> {
    let path = static_dir().join("img/face.png");
    std::fs::read(&path).unwrap_or_else(|error| panic!("cannot read {}: {error}", path.display()))
}

fn app(avatar_dir: Option<&std::path::Path>) -> axum::Router {
    let config = RankingConfig {
        static_dir: Some(static_dir()),
        avatar_dir: avatar_dir.map(std::path::Path::to_path_buf),
        ..Default::default()
    };
    // The entity routes on their own, without the session gate. This suite is about
    // which file the image route answers with, and the gate is covered by the
    // fail-closed suite; here it would only demand a live database for an image read.
    cms_ranking::entity_routes::routes(axum::Router::new())
        .with_state(AppState::new(None, config, None))
}

/// A directory of the test's own, removed on drop so parallel runs never share one.
struct Scratch(std::path::PathBuf);

impl Scratch {
    fn new(name: &str) -> Self {
        let path = std::env::temp_dir().join(format!("cms-ranking-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).expect("the scratch directory is creatable");
        Self(path)
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

async fn get(app: axum::Router, uri: &str) -> axum::response::Response {
    let request = Request::builder()
        .uri(uri)
        .body(Body::empty())
        .expect("a well formed request");
    app.oneshot(request).await.expect("the route answers")
}

async fn body_of(response: axum::response::Response) -> Vec<u8> {
    to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("the body reads")
        .to_vec()
}

#[tokio::test]
async fn an_uploaded_face_is_served_in_place_of_the_dummy() {
    let scratch = Scratch::new("uploaded");
    std::fs::write(scratch.0.join("u0.png"), b"uploaded face").expect("the file is writable");

    let response = get(app(Some(&scratch.0)), "/faces/u0").await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["content-type"], "image/png");
    assert_eq!(body_of(response).await, b"uploaded face");
}

#[tokio::test]
async fn a_jpg_upload_is_answered_as_jpeg() {
    let scratch = Scratch::new("jpeg");
    std::fs::write(scratch.0.join("t0.jpg"), b"a jpeg face").expect("the file is writable");

    let response = get(app(Some(&scratch.0)), "/faces/t0").await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["content-type"], "image/jpeg");
    assert_eq!(body_of(response).await, b"a jpeg face");
}

#[tokio::test]
async fn a_key_with_no_upload_gets_the_bundled_dummy() {
    let scratch = Scratch::new("missing");
    std::fs::write(scratch.0.join("someone-else.png"), b"not this one")
        .expect("the file is writable");

    let response = get(app(Some(&scratch.0)), "/faces/nobody").await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["content-type"], "image/png");
    assert_eq!(body_of(response).await, dummy_face());
}

#[tokio::test]
async fn a_face_is_still_served_when_no_upload_directory_is_configured() {
    let response = get(app(None), "/faces/u0").await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["content-type"], "image/png");
    assert_eq!(body_of(response).await, dummy_face());
}

#[tokio::test]
async fn a_key_that_would_escape_the_directory_is_answered_with_the_dummy() {
    let scratch = Scratch::new("traversal");
    // The file a decoded `../` key would name if the separator were accepted. It sits
    // beside the directory, so only a traversal can reach it.
    let outside = scratch
        .0
        .parent()
        .expect("the temp directory has a parent")
        .join(format!("cms-ranking-outside-{}.png", std::process::id()));
    std::fs::write(&outside, b"outside the directory").expect("the file is writable");
    let guard = ScratchGuard(outside);

    let response = get(app(Some(&scratch.0)), "/faces/%2E%2E%2Fcms-ranking-outside").await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["content-type"], "image/png");
    assert_eq!(body_of(response).await, dummy_face());
    drop(guard);
}

/// Removes the neighbour file the traversal test plants, since it lives outside the
/// scratch directory the other guard cleans up.
struct ScratchGuard(std::path::PathBuf);

impl Drop for ScratchGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}
