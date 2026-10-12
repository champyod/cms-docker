//! Contest scoping of the board's overrides: a configured contest must fold only its own
//! rows, and no configured contest must keep applying every active override.
//!
//! WHY a live database: the scope is a SQL predicate, so the behaviour under test is what
//! PostgreSQL returns, not a property a pure unit test can assert.

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
    const STATEMENTS: [&str; 8] = [
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

/// Two users on one task, and one hide override per contest, each naming a different user.
async fn seed_two_contests(pool: &PgPool) -> Result<(), sqlx::Error> {
    clear(pool).await?;
    sqlx::query(
        "INSERT INTO ranking_users (key, f_name, l_name, team) VALUES \
         ('u0', 'Grace', 'Hopper', NULL), ('u1', 'Alan', 'Turing', NULL)",
    )
    .execute(pool)
    .await?;
    sqlx::query(
        "INSERT INTO ranking_tasks (key, name, short_name, contest, max_score, \
         score_precision, extra_headers, display_order, score_mode) \
         VALUES ('t0', 'Task', 'T0', 'c0', 100.0, 0, '[]'::jsonb, 0, 'max')",
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

/// The regression: the service read every active override regardless of the contest the
/// panel filed it against. Contest 1 must apply its own hide and only its own.
#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables"]
async fn an_override_applies_only_to_its_own_contest() {
    let pool = pool();
    seed_two_contests(&pool).await.expect("the seed applies");

    let contest_one = load_board(&pool, Some(1))
        .await
        .expect("the board assembles");
    assert!(
        contest_one.contains_key("u0"),
        "contest 2's hide must not reach contest 1"
    );
    assert!(
        !contest_one.contains_key("u1"),
        "contest 1 hides its own row"
    );
}

/// Back-compat for a single-contest deployment: with no contest configured, every active
/// override still applies, which is the behaviour before the column was read.
#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables"]
async fn no_configured_contest_applies_every_override() {
    let pool = pool();
    seed_two_contests(&pool).await.expect("the seed applies");

    let board = load_board(&pool, None).await.expect("the board assembles");
    assert!(
        !board.contains_key("u0"),
        "with no scope every hide applies"
    );
    assert!(
        !board.contains_key("u1"),
        "with no scope every hide applies"
    );
}
