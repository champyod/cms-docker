//! Which contest the board is drawn for comes from the service registry, read per call.
//!
//! WHY a live database: the binding is a row in `services` and the board's scope is a SQL predicate
//! over `ranking_config`, so what is under test is what PostgreSQL answers — not a property a pure
//! unit test can assert. The harness is serialised in `.cargo/config.toml` like the other database
//! suites, because they share one Postgres.

use std::time::Duration;

use cms_ranking::binding::{
    load_served_contest, BindingCache, ServedContest, BINDING_MAX_AGE, SERVICE_ROLE,
};
use cms_ranking::db::Db;
use cms_ranking::store::{load_board, load_shown_set, StoreError};
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

const SHARD: u32 = 0;

async fn clear(pool: &PgPool) -> Result<(), sqlx::Error> {
    const STATEMENTS: [&str; 8] = [
        "DELETE FROM ranking_config",
        "DELETE FROM ranking_subchanges",
        "DELETE FROM ranking_submissions",
        "DELETE FROM ranking_tasks",
        "DELETE FROM ranking_users",
        "DELETE FROM ranking_overrides",
        "DELETE FROM ranking_hidden",
        "DELETE FROM services WHERE role = 'RankingWebServer'",
    ];
    for statement in STATEMENTS {
        sqlx::query(statement).execute(pool).await?;
    }
    Ok(())
}

/// Two contests with one scored task each. Enough to tell which contest a board was drawn for.
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
         ('s70', 'ghost0', 't7', 1), ('s80', 'ghost1', 't8', 1)",
    )
    .execute(pool)
    .await?;
    sqlx::query(
        "INSERT INTO ranking_subchanges (key, submission, time, score) VALUES \
         ('c70', 's70', 2, 10.0), ('c80', 's80', 2, 20.0)",
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Writes the shown set — the config, which stays what the board draws.
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

/// Writes the instance's own registry row.
async fn bind(pool: &PgPool, contest_id: Option<i32>, enabled: bool) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM services WHERE role = $1 AND shard = $2")
        .bind(SERVICE_ROLE)
        .bind(SHARD as i32)
        .execute(pool)
        .await?;
    sqlx::query(
        "INSERT INTO services (name, role, shard, host, http_port, contest_id, enabled, \
         created_at, updated_at) \
         VALUES ('cms-ranking-board', $1, $2, 'ranking-web-server', 8890, $3, $4, \
         now(), now())",
    )
    .bind(SERVICE_ROLE)
    .bind(SHARD as i32)
    .bind(contest_id)
    .bind(enabled)
    .execute(pool)
    .await?;
    Ok(())
}

/// The deployment the registry has not been told about yet: no row, so the config is the only
/// statement about which contest the board is — exactly the behaviour every instance had before the
/// registry carried a ranking row.
#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables"]
async fn an_instance_no_row_names_follows_the_config() {
    let pool = pool();
    seed_two_contests(&pool).await.expect("the seed applies");
    show_only(&pool, &[7, 8]).await.expect("the config applies");

    let served = load_served_contest(&pool, SHARD)
        .await
        .expect("the registry reads");
    assert_eq!(
        served,
        ServedContest::EveryContest,
        "no row names one contest"
    );

    let shown = load_shown_set(&pool, served)
        .await
        .expect("the scope reads");
    assert_eq!(
        shown.contest_ids(),
        &[7, 8],
        "the config is the whole answer"
    );

    clear(&pool).await.expect("the cleanup applies");
}

/// A row naming one of the shown contests bounds the board to that contest: the other shown
/// contest's columns and scores must not be drawn by an instance bound to a different one.
#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables"]
async fn a_bound_instance_draws_only_the_contest_it_serves() {
    let pool = pool();
    seed_two_contests(&pool).await.expect("the seed applies");
    show_only(&pool, &[7, 8]).await.expect("the config applies");
    bind(&pool, Some(7), true).await.expect("the row applies");

    let served = load_served_contest(&pool, SHARD)
        .await
        .expect("the registry reads");
    assert_eq!(served, ServedContest::Contest(7), "the row names contest 7");

    let board = load_board(&pool, served)
        .await
        .expect("the board assembles");
    let ghost0 = board
        .get("ghost0")
        .expect("contest 7's submission draws it");
    assert_eq!(ghost0.score, 10.0, "only contest 7's subchange is scored");
    assert!(
        !board.contains_key("ghost1"),
        "a contestant who only scored in contest 8 is on no row of a board bound to contest 7"
    );

    clear(&pool).await.expect("the cleanup applies");
}

/// The two rows disagreeing is a refusal that names both, never a silent pick: an operator who
/// re-points the shard without re-pointing the config must be told, not shown another contest.
#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables"]
async fn a_row_naming_a_contest_the_config_does_not_show_is_refused() {
    let pool = pool();
    seed_two_contests(&pool).await.expect("the seed applies");
    show_only(&pool, &[7]).await.expect("the config applies");
    bind(&pool, Some(8), true).await.expect("the row applies");

    let served = load_served_contest(&pool, SHARD)
        .await
        .expect("the registry reads");
    match load_shown_set(&pool, served).await {
        Err(StoreError::ServedContestNotShown { served, shown }) => {
            assert_eq!(served, 8, "the refusal names the bound contest");
            assert_eq!(shown, "7", "and the contest the config shows");
        }
        other => panic!("a contradiction must be a refusal, got {other:?}"),
    }

    clear(&pool).await.expect("the cleanup applies");
}

/// A disabled row is not the binding. Turning a row off is how an operator takes a shard out of
/// the registry, so the reader has to fall back to the config rather than keep honouring it.
#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables"]
async fn a_disabled_row_does_not_bind() {
    let pool = pool();
    seed_two_contests(&pool).await.expect("the seed applies");
    bind(&pool, Some(8), false).await.expect("the row applies");

    let served = load_served_contest(&pool, SHARD)
        .await
        .expect("the registry reads");
    assert_eq!(served, ServedContest::EveryContest);

    clear(&pool).await.expect("the cleanup applies");
}

/// The hot lever: re-pointing the row reaches the reader within one TTL, with no restart and no
/// process state to reset. Inside the TTL the cached answer is served — that is the cost of the
/// cache, and it is bounded — and past it the new row is read.
///
/// WHY the clock is real here: the cache and the pool share tokio's timer, so a paused clock would
/// stall the pool's own acquire timeout instead of proving anything about the binding.
#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables"]
async fn a_repointed_row_reaches_the_reader_within_the_ttl() {
    let pool = pool();
    seed_two_contests(&pool).await.expect("the seed applies");
    bind(&pool, Some(7), true).await.expect("the row applies");

    let cache = BindingCache::default();
    let first = cache
        .served_contest(SHARD, &pool)
        .await
        .expect("the binding reads");
    assert_eq!(first, ServedContest::Contest(7));

    bind(&pool, Some(8), true).await.expect("the row moves");

    let inside = cache
        .served_contest(SHARD, &pool)
        .await
        .expect("the binding reads");
    assert_eq!(
        inside,
        ServedContest::Contest(7),
        "inside the TTL the row is not re-read"
    );

    tokio::time::sleep(BINDING_MAX_AGE + Duration::from_millis(100)).await;
    let after = cache
        .served_contest(SHARD, &pool)
        .await
        .expect("the binding reads");
    assert_eq!(
        after,
        ServedContest::Contest(8),
        "one TTL after the write the reader follows the row, with no restart"
    );

    clear(&pool).await.expect("the cleanup applies");
}
