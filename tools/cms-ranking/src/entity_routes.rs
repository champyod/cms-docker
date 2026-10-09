use axum::extract::{Path, State};
use axum::http::header;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, MethodRouter};
use axum::Router;

use crate::entities::{self, Kind};
use crate::http::{not_found, refuse};
use crate::json::{bytes_response, stamped};
use crate::AppState;

/// Which bundled fallback a route serves. The projection carries no per-entity
/// image, so an entity that exists gets this dummy while an unknown key is a 404.
#[derive(Debug, Clone, Copy)]
enum Fallback {
    Face,
    Flag,
}

impl Fallback {
    fn file(self) -> &'static str {
        match self {
            Self::Face => "face.png",
            Self::Flag => "flag.png",
        }
    }
}

pub fn routes(router: Router<AppState>) -> Router<AppState> {
    router
        .route("/contests/", list_route(Kind::Contest))
        .route("/contests/{key}", one_route(Kind::Contest))
        .route("/tasks/", list_route(Kind::Task))
        .route("/tasks/{key}", one_route(Kind::Task))
        .route("/teams/", list_route(Kind::Team))
        .route("/teams/{key}", one_route(Kind::Team))
        .route("/users/", list_route(Kind::User))
        .route("/users/{key}", one_route(Kind::User))
        .route("/sublist/{user}", get(sublist))
        .route("/faces/{user}", image_route(Fallback::Face))
        .route("/flags/{team}", image_route(Fallback::Flag))
}

fn list_route(kind: Kind) -> MethodRouter<AppState> {
    get(move |State(state): State<AppState>| async move { list(state, kind).await })
}

fn one_route(kind: Kind) -> MethodRouter<AppState> {
    get(
        move |State(state): State<AppState>, Path(key): Path<String>| async move {
            one(state, kind, &key).await
        },
    )
}

fn image_route(fallback: Fallback) -> MethodRouter<AppState> {
    get(
        move |State(state): State<AppState>, Path(key): Path<String>| async move {
            image(state, &key, fallback).await
        },
    )
}

async fn list(state: AppState, kind: Kind) -> Response {
    let Some(db) = state.db() else {
        return refuse("no database is configured");
    };
    match entities::list_body(db.pool(), kind).await {
        Ok(body) => stamped(bytes_response(body)),
        Err(error) => refuse(&error.to_string()),
    }
}

async fn one(state: AppState, kind: Kind, key: &str) -> Response {
    let Some(db) = state.db() else {
        return refuse("no database is configured");
    };
    match entities::one_body(db.pool(), kind, key).await {
        Ok(Some(body)) => stamped(bytes_response(body)),
        Ok(None) => not_found(),
        Err(error) => refuse(&error.to_string()),
    }
}

async fn sublist(State(state): State<AppState>, Path(user): Path<String>) -> Response {
    let Some(db) = state.db() else {
        return refuse("no database is configured");
    };
    match entities::sublist_body(db.pool(), &user).await {
        Ok(body) => bytes_response(body),
        Err(error) => refuse(&error.to_string()),
    }
}

/// Never a 404: the service treats the key as a filename pattern and answers with its bundled
/// fallback whenever nothing matches, so a key naming nothing gets the same dummy as an entity
/// with no image. It needs no database for the same reason, and a 404 here would be a divergence
/// from the service being replaced rather than a stricter check.
async fn image(state: AppState, _key: &str, fallback: Fallback) -> Response {
    bundled(&state, fallback).await
}

async fn bundled(state: &AppState, fallback: Fallback) -> Response {
    let Some(directory) = state.config().static_dir.as_ref() else {
        return refuse("no RANKING_STATIC_DIR is configured");
    };
    let path = directory.join("img").join(fallback.file());
    match tokio::fs::read(&path).await {
        Ok(bytes) => ([(header::CONTENT_TYPE, "image/png")], bytes).into_response(),
        Err(error) => refuse(&format!("{}: {error}", path.display())),
    }
}
