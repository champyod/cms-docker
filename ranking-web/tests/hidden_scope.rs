//! What the board shows bounds every read it makes — the ledger's columns and the hidden
//! tombstones alike. A tombstone filed against a contest applies while the config shows that
//! contest and no further, and with the config showing nothing the board draws nothing at all.
//!
//! WHY a live database: the scope is a SQL predicate over the shown set, so the behaviour under
//! test is what PostgreSQL returns, not a property a pure unit test can assert.

use cms_ranking::db::Db;
use cms_ranking::store::{load_board, load_ledger};
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
    const STATEMENTS: [&str; 10] = [
        "DELETE FROM ranking_config",
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

/// Two contests, each with one scored task, both contestants scoring on both, and one hidden
/// participation filed against contest 7 only.
async fn seed_two_contests(pool: &PgPool) -> Result<(), sqlx::Error> {
    clear(pool).await?;
    sqlx::query(
        "INSERT INTO ranking_users (key, f_name, l_name, team) VALUES \
         ('ghost0', 'Grace', 'Hopper', NULL), ('ghost1', 'Alan', 'Turing', NULL)",
    )
    .execute(pool)
    .await?;
    sqlx::query(
        "INSERT INTO ranking_tasks (key, name, short_name, contest, contest_id, max_score, \
         score_precision, extra_headers, display_order, score_mode) VALUES \
         ('t7', 'Day One', 'T7', 'c7', 7, 100.0, 0, '[]'::jsonb, 0, 'max'), \
         ('t8', 'Day Two', 'T8', 'c8', 8, 100.0, 0, '[]'::jsonb, 1, 'max')",
    )
    .execute(pool)
    .await?;
    sqlx::query(
        "INSERT INTO ranking_submissions (key, \"user\", task, time) VALUES \
         ('s70', 'ghost0', 't7', 1), ('s71', 'ghost1', 't7', 1), \
         ('s80', 'ghost0', 't8', 1), ('s81', 'ghost1', 't8', 1)",
    )
    .execute(pool)
    .await?;
    sqlx::query(
        "INSERT INTO ranking_subchanges (key, submission, time, score) VALUES \
         ('c70', 's70', 2, 10.0), ('c71', 's71', 2, 20.0), \
         ('c80', 's80', 2, 30.0), ('c81', 's81', 2, 40.0)",
    )
    .execute(pool)
    .await?;
    sqlx::query("INSERT INTO ranking_hidden (key, contest_id) VALUES ('ghost0', 7)")
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

/// The regression: a tombstone must reach only the contest it was filed against. It bites
/// while that contest is shown, and stops biting the moment the config shows another — and a
/// config showing nothing draws nothing rather than falling back to a contest of its own
/// choosing.
#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables"]
async fn a_tombstone_reaches_only_the_contest_the_config_shows() {
    let pool = pool();
    seed_two_contests(&pool).await.expect("the seed applies");

    show_only(&pool, &[7]).await.expect("the config applies");
    let day_one = load_board(&pool).await.expect("the board assembles");
    assert!(
        !day_one.contains_key("ghost0"),
        "contest 7 hides the participation filed against it"
    );
    assert!(
        day_one.contains_key("ghost1"),
        "a key with no tombstone stays on the board"
    );

    show_only(&pool, &[8]).await.expect("the config applies");
    let day_two = load_board(&pool).await.expect("the board assembles");
    assert!(
        day_two.contains_key("ghost0"),
        "contest 7's tombstone must not reach contest 8"
    );

    show_only(&pool, &[]).await.expect("the config applies");
    let none = load_board(&pool).await.expect("the board assembles");
    assert!(
        none.is_empty(),
        "with nothing shown the board draws nothing rather than picking a contest"
    );

    clear(&pool).await.expect("the cleanup applies");
}

/// Item D10: the task read used to carry no scope at all, so a database holding more than one
/// contest's projected rows drew every contest's columns and a day-2 board had to have the
/// day-1 columns hidden by hand. The shown set is now the scope of that read.
#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables"]
async fn a_board_draws_only_the_columns_of_the_contest_it_shows() {
    let pool = pool();
    seed_two_contests(&pool).await.expect("the seed applies");

    show_only(&pool, &[8]).await.expect("the config applies");
    let ledger = load_ledger(&pool).await.expect("the ledger assembles");
    assert!(
        ledger.scores().values().any(|row| row.contains_key("t8")),
        "the shown contest's column is drawn"
    );
    assert!(
        !ledger.scores().values().any(|row| row.contains_key("t7")),
        "the contest that is not shown contributes no column"
    );
    assert!(
        ledger.history().iter().all(|entry| entry.1 != "t7"),
        "and no history of it either"
    );

    clear(&pool).await.expect("the cleanup applies");
}
