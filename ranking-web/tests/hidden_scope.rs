//! Contest scoping of the board's hidden tombstones: a configured contest must drop only
//! its own hidden participations, and no configured contest must drop every tombstone.
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
    const STATEMENTS: [&str; 9] = [
        "DELETE FROM ranking_hidden",
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

/// Two users on one task, and one hidden participation filed against contest 7.
async fn seed_two_contests(pool: &PgPool) -> Result<(), sqlx::Error> {
    clear(pool).await?;
    sqlx::query(
        "INSERT INTO ranking_users (key, f_name, l_name, team) VALUES \
         ('ghost0', 'Grace', 'Hopper', NULL), ('ghost1', 'Alan', 'Turing', NULL)",
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
         ('s0', 'ghost0', 't0', 1), ('s1', 'ghost1', 't0', 1)",
    )
    .execute(pool)
    .await?;
    sqlx::query(
        "INSERT INTO ranking_subchanges (key, submission, time, score) VALUES \
         ('c0', 's0', 2, 10.0), ('c1', 's1', 2, 30.0)",
    )
    .execute(pool)
    .await?;
    sqlx::query("INSERT INTO ranking_hidden (key, contest_id) VALUES ('ghost0', 7)")
        .execute(pool)
        .await?;
    Ok(())
}

/// The regression: a tombstone must reach only the contest it was filed against, so the
/// board of another contest keeps the user ranked; and with no contest configured every
/// tombstone applies, the same fallback the overrides themselves take. WHY one case: both
/// halves `clear()` and seed the same live tables, so running them as two tests in one
/// binary let their seeds interleave.
#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables"]
async fn a_tombstone_scopes_to_its_contest_and_applies_without_one() {
    let pool = pool();
    seed_two_contests(&pool).await.expect("the seed applies");

    let contest_seven = load_board(&pool, Some(7))
        .await
        .expect("the board assembles");
    assert!(
        !contest_seven.contains_key("ghost0"),
        "contest 7 hides the participation filed against it"
    );
    assert!(
        contest_seven.contains_key("ghost1"),
        "a key with no tombstone stays on the board"
    );

    let contest_eight = load_board(&pool, Some(8))
        .await
        .expect("the board assembles");
    assert!(
        contest_eight.contains_key("ghost0"),
        "contest 7's tombstone must not reach contest 8"
    );

    let unscoped = load_board(&pool, None).await.expect("the board assembles");
    assert!(
        !unscoped.contains_key("ghost0"),
        "with no scope the tombstone applies"
    );

    clear(&pool).await.expect("the cleanup applies");
}
