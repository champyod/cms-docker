//! What the entity reads serve: a key outside the shown set is a missing row, so the routes answer
//! it the same way they answer a key that never existed (item R1, the read side).
//!
//! WHY a live database: the scope is a SQL predicate over the projection and the config, so the
//! behaviour under test is what PostgreSQL returns. The routes are driven through the router
//! rather than the bodies, because the answer the page sees is the status code.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use cms_ranking::config::RankingConfig;
use cms_ranking::db::Db;
use cms_ranking::{router, AppState};
use sqlx::PgPool;
use tokio::sync::{Mutex, MutexGuard};
use tower::ServiceExt;

/// Every test here owns the whole projection for its duration, so two of them clearing it at once
/// would race on rows neither seeded. cargo runs one test binary at a time, so a lock inside the
/// binary is enough.
static EXCLUSIVE: Mutex<()> = Mutex::const_new(());

async fn exclusive() -> MutexGuard<'static, ()> {
    EXCLUSIVE.lock().await
}

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

fn app() -> axum::Router {
    let db = Db::connect_lazy(&database_url()).expect("a valid database url");
    router(AppState::new(Some(db), RankingConfig::default(), None))
}

async fn get(uri: &str) -> (StatusCode, Option<serde_json::Value>) {
    let request = Request::builder()
        .uri(uri)
        .body(Body::empty())
        .expect("a well formed request");
    let response = app()
        .oneshot(request)
        .await
        .expect("the router is infallible");
    let status = response.status();
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("a body");
    let parsed = serde_json::from_slice::<serde_json::Value>(&body).ok();
    (status, parsed)
}

async fn clear(pool: &PgPool) -> Result<(), sqlx::Error> {
    const STATEMENTS: [&str; 10] = [
        "DELETE FROM ranking_config",
        "DELETE FROM ranking_hidden",
        "DELETE FROM ranking_subchanges",
        "DELETE FROM ranking_settings",
        "DELETE FROM ranking_overrides",
        "DELETE FROM ranking_submissions",
        "DELETE FROM ranking_tasks",
        "DELETE FROM ranking_users",
        "DELETE FROM ranking_teams",
        "DELETE FROM ranking_contests",
    ];
    for statement in STATEMENTS {
        sqlx::query(statement).execute(pool).await?;
    }
    Ok(())
}

/// Two contests projected side by side, each with its own task, team and participant, and the
/// config naming contest 7 only: every entity of contest 8 is one the read must refuse.
async fn seed_two_contests(pool: &PgPool, shown: &[i32]) -> Result<(), sqlx::Error> {
    clear(pool).await?;
    sqlx::query(
        "INSERT INTO ranking_contests (key, name, begin, \"end\", score_precision, contest_id) \
         VALUES ('c7', 'Day One', 1, 2, 0, 7), ('c8', 'Day Two', 3, 4, 0, 8)",
    )
    .execute(pool)
    .await?;
    sqlx::query(
        "INSERT INTO ranking_tasks (key, name, short_name, contest, contest_id, max_score, \
         score_precision, extra_headers, display_order, score_mode) VALUES \
         ('t7', 'Shown Task', 'T7', 'c7', 7, 100.0, 0, '[]'::jsonb, 0, 'max'), \
         ('t8', 'Unshown Task', 'T8', 'c8', 8, 100.0, 0, '[]'::jsonb, 1, 'max')",
    )
    .execute(pool)
    .await?;
    sqlx::query(
        "INSERT INTO ranking_teams (key, name) VALUES ('team7', 'Shown Team'), \
         ('team8', 'Unshown Team')",
    )
    .execute(pool)
    .await?;
    sqlx::query(
        "INSERT INTO ranking_users (key, f_name, l_name, team) VALUES \
         ('u7', 'Ada', 'Shown', 'team7'), ('u8', 'Alan', 'Unshown', 'team8')",
    )
    .execute(pool)
    .await?;
    sqlx::query(
        "INSERT INTO ranking_submissions (key, \"user\", task, time) VALUES \
         ('s7', 'u7', 't7', 1), ('s8', 'u8', 't8', 1)",
    )
    .execute(pool)
    .await?;
    for contest_id in shown {
        sqlx::query("INSERT INTO ranking_config (target_kind, target_key) VALUES ('contest', $1)")
            .bind(contest_id.to_string())
            .execute(pool)
            .await?;
    }
    Ok(())
}

#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables"]
async fn a_contest_and_a_task_are_served_only_while_the_config_shows_them() {
    let _guard = exclusive().await;
    let pool = pool();
    seed_two_contests(&pool, &[7])
        .await
        .expect("the seed applies");

    assert_eq!(get("/contests/c7").await.0, StatusCode::OK);
    assert_eq!(get("/tasks/t7").await.0, StatusCode::OK);
    assert_eq!(
        get("/contests/c8").await.0,
        StatusCode::NOT_FOUND,
        "a contest the config does not show reads as a missing row"
    );
    assert_eq!(
        get("/tasks/t8").await.0,
        StatusCode::NOT_FOUND,
        "and so does a task of it"
    );

    // The same keys the other way round: what the read refuses is decided by the config, not by
    // the row, so moving the shown set moves the served set.
    sqlx::query("DELETE FROM ranking_config")
        .execute(&pool)
        .await
        .expect("the config clears");
    sqlx::query("INSERT INTO ranking_config (target_kind, target_key) VALUES ('contest', '8')")
        .execute(&pool)
        .await
        .expect("the config applies");
    assert_eq!(get("/contests/c8").await.0, StatusCode::OK);
    assert_eq!(get("/contests/c7").await.0, StatusCode::NOT_FOUND);

    clear(&pool).await.expect("the cleanup applies");
}

/// Teams and users carry no contest of their own, so the read scopes them by what the board draws
/// them through: a submission on a shown contest's task.
#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables"]
async fn a_user_and_a_team_are_served_only_when_the_board_draws_them() {
    let _guard = exclusive().await;
    let pool = pool();
    seed_two_contests(&pool, &[7])
        .await
        .expect("the seed applies");

    assert_eq!(get("/users/u7").await.0, StatusCode::OK);
    assert_eq!(get("/teams/team7").await.0, StatusCode::OK);
    assert_eq!(
        get("/users/u8").await.0,
        StatusCode::NOT_FOUND,
        "a user only the unshown contest draws reads as a missing row"
    );
    assert_eq!(
        get("/teams/team8").await.0,
        StatusCode::NOT_FOUND,
        "and so does a team drawn only through them"
    );

    clear(&pool).await.expect("the cleanup applies");
}

/// The lists and the one-entity reads answer with one set: every key a list serves reads back, and
/// a key the list leaves out is a 404. This is the property the two seams used to break, because
/// the lists were scoped and the reads were not.
#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables"]
async fn every_key_a_list_serves_reads_back_and_a_key_it_leaves_out_does_not() {
    let _guard = exclusive().await;
    let pool = pool();
    seed_two_contests(&pool, &[7])
        .await
        .expect("the seed applies");

    for (prefix, served, refused) in [
        ("/contests/", "c7", "c8"),
        ("/tasks/", "t7", "t8"),
        ("/users/", "u7", "u8"),
        ("/teams/", "team7", "team8"),
    ] {
        let (status, body) = get(prefix).await;
        assert_eq!(status, StatusCode::OK, "{prefix} answers");
        let keyed = body.expect("a keyed body");
        let keys = keyed.as_object().expect("an object keyed by key").clone();
        assert_eq!(
            keys.len(),
            1,
            "{prefix} serves only the key the board draws: {keyed}"
        );
        assert_eq!(
            get(&format!("{prefix}{served}")).await.0,
            StatusCode::OK,
            "{prefix} serves {served} and {prefix}{served} must read it back"
        );
        assert_eq!(
            get(&format!("{prefix}{refused}")).await.0,
            StatusCode::NOT_FOUND,
            "{prefix} leaves {refused} out and {prefix}{refused} must refuse it"
        );
    }

    clear(&pool).await.expect("the cleanup applies");
}

/// A board that shows nothing draws nothing: the reads refuse every key rather than falling back
/// to a contest nobody chose.
#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables"]
async fn with_nothing_shown_every_read_is_a_404() {
    let _guard = exclusive().await;
    let pool = pool();
    seed_two_contests(&pool, &[])
        .await
        .expect("the seed applies");

    for route in [
        "/contests/c7",
        "/tasks/t7",
        "/users/u7",
        "/teams/team7",
        "/contests/c8",
    ] {
        assert_eq!(get(route).await.0, StatusCode::NOT_FOUND, "{route}");
    }

    clear(&pool).await.expect("the cleanup applies");
}
