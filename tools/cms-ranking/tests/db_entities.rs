//! The entity routes against a live projection. These are ignored for the same
//! reason db_reads.rs is: a missing database is an environment gap, not a defect,
//! and CI runs them with --include-ignored against a postgres service.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use cms_ranking::config::RankingConfig;
use cms_ranking::db::Db;
use cms_ranking::{router, AppState};
use sqlx::PgPool;
use tower::ServiceExt;

fn database_url() -> String {
    std::env::var("RANKING_TEST_DATABASE_URL")
        .or_else(|_| std::env::var("DATABASE_URL"))
        .expect("RANKING_TEST_DATABASE_URL or DATABASE_URL must name a test database")
}

fn pool() -> PgPool {
    Db::connect_lazy(&database_url())
        .expect("a valid database url")
        .pool()
        .clone()
}

async fn clear(pool: &PgPool) -> Result<(), sqlx::Error> {
    const STATEMENTS: [&str; 7] = [
        "DELETE FROM ranking_subchanges",
        "DELETE FROM ranking_submissions",
        "DELETE FROM ranking_tasks",
        "DELETE FROM ranking_users",
        "DELETE FROM ranking_teams",
        "DELETE FROM ranking_contests",
        "DELETE FROM ranking_settings",
    ];
    for statement in STATEMENTS {
        sqlx::query(statement).execute(pool).await?;
    }
    Ok(())
}

/// The router as the page reaches it: the lazy pool, the vendored static directory
/// for the bundled face and flag, and no console counter.
fn app() -> axum::Router {
    let config = RankingConfig {
        static_dir: Some(
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../src/cmsranking/static"),
        ),
        ..Default::default()
    };
    let db = Db::connect_lazy(&database_url()).expect("a valid database url");
    router(AppState::new(Some(db), config, None))
}

async fn get(app: axum::Router, uri: &str) -> axum::response::Response {
    let request = Request::builder()
        .uri(uri)
        .body(Body::empty())
        .expect("a well formed request");
    app.oneshot(request)
        .await
        .expect("the router is infallible")
}

async fn seed_entities(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO ranking_contests (key, name, begin, "end", score_precision)
        VALUES ('c0', 'Parity', 1, 2, 0)"#,
    )
    .execute(pool)
    .await?;
    sqlx::query(
        "INSERT INTO ranking_tasks (key, name, short_name, contest, max_score, \
         score_precision, extra_headers, display_order, score_mode) \
         VALUES ('t0', 'A Plus B', 'aplusb', 'c0', 100.0, 0, '[]'::jsonb, 0, 'max')",
    )
    .execute(pool)
    .await?;
    sqlx::query("INSERT INTO ranking_teams (key, name) VALUES ('team0', 'Fixture Team')")
        .execute(pool)
        .await?;
    sqlx::query(
        "INSERT INTO ranking_users (key, f_name, l_name, team) VALUES ('u0', 'Ada', 'Zero', 'team0')",
    )
    .execute(pool)
    .await?;
    Ok(())
}

#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables"]
async fn an_entity_list_is_keyed_and_carries_the_timestamp() {
    let pool = pool();
    clear(&pool).await.expect("the tables are reachable");
    seed_entities(&pool).await.expect("the seed applies");
    let response = get(app(), "/contests/").await;
    assert_eq!(response.status(), StatusCode::OK);
    assert!(response.headers().contains_key("Timestamp"));
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("a body");
    let parsed: serde_json::Value = serde_json::from_slice(&body).expect("json");
    assert_eq!(parsed["c0"]["name"], "Parity");
    assert_eq!(parsed["c0"]["score_precision"], 0);
    // The header is exactly where the capture puts it, and /history is not one of them.
    assert!(!get(app(), "/history")
        .await
        .headers()
        .contains_key("Timestamp"));
}

#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables"]
async fn an_unknown_entity_key_is_a_404() {
    let pool = pool();
    clear(&pool).await.expect("the tables are reachable");
    assert_eq!(
        get(app(), "/users/nobody").await.status(),
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables"]
async fn a_known_entity_falls_back_to_the_bundled_image() {
    let pool = pool();
    clear(&pool).await.expect("the tables are reachable");
    seed_entities(&pool).await.expect("the seed applies");
    let response = get(app(), "/faces/u0").await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["content-type"], "image/png");
    assert_eq!(get(app(), "/flags/team0").await.status(), StatusCode::OK);
    // The Python handler never looked the entity up, so an unknown key gets the same
    // dummy image rather than a 404.
    let unknown = get(app(), "/faces/nobody").await;
    assert_eq!(unknown.status(), StatusCode::OK);
    assert_eq!(unknown.headers()["content-type"], "image/png");
}

#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables"]
async fn a_user_with_no_submissions_gets_an_empty_sublist() {
    let pool = pool();
    clear(&pool).await.expect("the tables are reachable");
    let response = get(app(), "/sublist/u0").await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("a body");
    assert_eq!(body.as_ref(), b"[]");
}
