//! Contest scoping of the board's overrides: the board folds only the rows filed against a
//! contest the config shows, and a config that shows nothing folds none of them.
//!
//! WHY a live database: the scope is a SQL predicate over the shown set, so the behaviour under
//! test is what PostgreSQL returns, not a property a pure unit test can assert.

use cms_ranking::db::Db;
use cms_ranking::store::load_board;
use sqlx::PgPool;

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
    const STATEMENTS: [&str; 9] = [
        "DELETE FROM ranking_config",
        "DELETE FROM ranking_subchanges",
        "DELETE FROM ranking_submissions",
        "DELETE FROM ranking_tasks",
        "DELETE FROM ranking_settings",
        "DELETE FROM ranking_overrides",
        "DELETE FROM ranking_users",
        "DELETE FROM ranking_teams",
        "DELETE FROM ranking_contests",
    ];
    for statement in STATEMENTS {
        sqlx::query(statement).execute(pool).await?;
    }
    Ok(())
}

/// Two users on one task filed under contest 1, and one hide override per contest, each naming
/// a different user.
async fn seed_two_contests(pool: &PgPool) -> Result<(), sqlx::Error> {
    clear(pool).await?;
    sqlx::query(
        "INSERT INTO ranking_users (key, f_name, l_name, team) VALUES \
         ('u0', 'Grace', 'Hopper', NULL), ('u1', 'Alan', 'Turing', NULL)",
    )
    .execute(pool)
    .await?;
    sqlx::query(
        "INSERT INTO ranking_tasks (key, name, short_name, contest, contest_id, max_score, \
         score_precision, extra_headers, display_order, score_mode) \
         VALUES ('t0', 'Task', 'T0', 'c0', 1, 100.0, 0, '[]'::jsonb, 0, 'max')",
    )
    .execute(pool)
    .await?;
    sqlx::query(
        "INSERT INTO ranking_submissions (key, \"user\", task, time) VALUES \
         ('s0', 'u0', 't0', 1), ('s1', 'u1', 't0', 1)",
    )
    .execute(pool)
    .await?;
    sqlx::query(
        "INSERT INTO ranking_subchanges (key, submission, time, score) VALUES \
         ('c0', 's0', 2, 10.0), ('c1', 's1', 2, 30.0)",
    )
    .execute(pool)
    .await?;
    sqlx::query(
        "INSERT INTO ranking_overrides (contest_id, target_kind, target_key, action, payload, reason) \
         VALUES (1, 'user', 'u1', 'hide', NULL, 'scope test'), \
                (2, 'user', 'u0', 'hide', NULL, 'scope test')",
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Writes the shown set, which is the only thing that decides what the board draws.
async fn show_only(pool: &PgPool, contest_ids: &[i32]) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM ranking_config")
        .execute(pool)
        .await?;
    for contest_id in contest_ids {
        sqlx::query("INSERT INTO ranking_config (target_kind, target_key) VALUES ('contest', $1)")
            .bind(contest_id.to_string())
            .execute(pool)
            .await?;
    }
    Ok(())
}

/// The regression: the service read every active override regardless of the contest the panel
/// filed it against, so a row hidden for another day took a contestant off this board.
#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables"]
async fn an_override_applies_only_to_the_contest_the_config_shows() {
    let pool = pool();
    seed_two_contests(&pool).await.expect("the seed applies");

    show_only(&pool, &[1]).await.expect("the config applies");
    let contest_one = load_board(&pool).await.expect("the board assembles");
    assert!(
        !contest_one.contains_key("u1"),
        "contest 1 folds its own hide"
    );
    assert!(
        contest_one.contains_key("u0"),
        "contest 2's hide must not reach the board showing contest 1"
    );

    show_only(&pool, &[2]).await.expect("the config applies");
    let contest_two = load_board(&pool).await.expect("the board assembles");
    assert!(
        contest_two.is_empty(),
        "a shown contest the projection holds no rows for draws nothing, not another contest"
    );

    clear(&pool).await.expect("the cleanup applies");
}

/// The classic default is gone: a config showing nothing folds no override and draws no row,
/// rather than falling back to applying every active override.
#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables"]
async fn a_config_showing_nothing_folds_no_override() {
    let pool = pool();
    seed_two_contests(&pool).await.expect("the seed applies");
    show_only(&pool, &[]).await.expect("the config applies");

    let board = load_board(&pool).await.expect("the board assembles");
    assert!(
        board.is_empty(),
        "with nothing shown the board draws nothing"
    );

    clear(&pool).await.expect("the cleanup applies");
}
