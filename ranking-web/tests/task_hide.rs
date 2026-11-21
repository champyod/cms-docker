//! A task hidden by an override: the column, the scores and the history leave the board
//! together while the task keeps its own row and metadata.
//!
//! WHY a live database: the drop is one predicate read through two SQL paths, the entity
//! list and the ledger, so the behaviour under test is what PostgreSQL returns rather
//! than a property a pure unit test can assert.

use cms_ranking::binding::ServedContest;
use cms_ranking::db::Db;
use cms_ranking::entities::{list_body, Kind};
use cms_ranking::store::{load_ledger, ShownSet};
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

/// One scored submission on one task, with no override yet. The config row is what makes the
/// task drawable at all: the board shows contest 1 because the config says so.
async fn seed_scored_task(pool: &PgPool) -> Result<(), sqlx::Error> {
    clear(pool).await?;
    sqlx::query("INSERT INTO ranking_config (target_kind, target_key) VALUES ('contest', '1')")
        .execute(pool)
        .await?;
    sqlx::query(
        "INSERT INTO ranking_users (key, f_name, l_name, team) \
         VALUES ('u0', 'Ada', 'Lovelace', NULL)",
    )
    .execute(pool)
    .await?;
    sqlx::query(
        "INSERT INTO ranking_tasks (key, name, short_name, contest, contest_id, max_score, \
         score_precision, extra_headers, display_order, score_mode) \
         VALUES ('t0', 'A Plus B', 'aplusb', 'c0', 1, 100.0, 0, '[]'::jsonb, 0, 'max')",
    )
    .execute(pool)
    .await?;
    sqlx::query(
        "INSERT INTO ranking_submissions (key, \"user\", task, time) VALUES ('s0', 'u0', 't0', 1)",
    )
    .execute(pool)
    .await?;
    sqlx::query(
        "INSERT INTO ranking_subchanges (key, submission, time, score) VALUES ('c0', 's0', 2, 30.0)",
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// The composite key the picker writes: the encoded contest the task is filed under,
/// then the encoded task name, joined by a slash neither half can contain.
async fn hide_task(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO ranking_overrides (contest_id, target_kind, target_key, action, payload, reason) \
         VALUES (1, 'task', 'c0/t0', 'hide', NULL, 'task withdrawn')",
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// A pre-composite row: the bare task name with no contest, which must keep hiding the
/// task wherever it appears rather than being dropped as an unreadable key.
async fn hide_task_bare(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO ranking_overrides (contest_id, target_kind, target_key, action, payload, reason) \
         VALUES (1, 'task', 't0', 'hide', NULL, 'legacy task withdrawn')",
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// The shown set the seeds put the task inside; the reader's own scope comes from the config.
fn shown() -> ShownSet {
    ShownSet::new(vec![1])
}

async fn listed_tasks(pool: &PgPool) -> serde_json::Value {
    let body = list_body(pool, Kind::Task, &shown())
        .await
        .expect("the task list renders");
    serde_json::from_slice(&body).expect("the task list is json")
}

/// The baseline the hide is judged against: an unhidden task is a column and a score.
#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables"]
async fn an_unhidden_task_is_a_column_and_a_score() {
    let pool = pool();
    seed_scored_task(&pool).await.expect("the seed applies");

    let tasks = listed_tasks(&pool).await;
    assert!(tasks.get("t0").is_some(), "an unhidden task is a column");

    let ledger = load_ledger(&pool, ServedContest::EveryContest)
        .await
        .expect("the ledger assembles");
    assert_eq!(
        ledger.scores().get("u0").and_then(|row| row.get("t0")),
        Some(&30.0),
        "an unhidden task scores"
    );
}

/// The regression: hiding a task used to mean clearing its dataset, which stripped the
/// contestant-facing metadata. It must instead drop the column, the score and the
/// history from the board while the task row keeps everything it had.
#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables"]
async fn a_hidden_task_leaves_the_column_and_the_ledger_together() {
    let pool = pool();
    seed_scored_task(&pool).await.expect("the seed applies");
    hide_task(&pool).await.expect("the override applies");

    let tasks = listed_tasks(&pool).await;
    assert!(
        tasks.get("t0").is_none(),
        "the hidden task leaves the column list"
    );

    let ledger = load_ledger(&pool, ServedContest::EveryContest)
        .await
        .expect("the ledger assembles");
    assert!(
        !ledger.scores().values().any(|row| row.contains_key("t0")),
        "the hidden task leaves the score grid"
    );
    assert!(
        ledger.history().iter().all(|entry| entry.1 != "t0"),
        "the hidden task leaves the history"
    );
    assert!(
        ledger.board().is_empty(),
        "with its only task hidden nobody is ranked"
    );

    let kept: Option<(String, String, String)> =
        sqlx::query_as("SELECT name, contest, score_mode FROM ranking_tasks WHERE key = 't0'")
            .fetch_optional(&pool)
            .await
            .expect("the task row is readable");
    assert_eq!(
        kept,
        Some(("A Plus B".to_string(), "c0".to_string(), "max".to_string())),
        "the task keeps its row and its metadata"
    );

    clear(&pool).await.expect("the cleanup applies");
}

/// Back-compat: a pre-composite row names the task with no contest, and must keep hiding
/// it in every contest rather than being refused as an unreadable key.
#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables"]
async fn a_bare_task_key_still_hides_the_task() {
    let pool = pool();
    seed_scored_task(&pool).await.expect("the seed applies");
    hide_task_bare(&pool).await.expect("the override applies");

    let tasks = listed_tasks(&pool).await;
    assert!(
        tasks.get("t0").is_none(),
        "the legacy bare key still drops the column"
    );

    let ledger = load_ledger(&pool, ServedContest::EveryContest)
        .await
        .expect("the ledger assembles");
    assert!(
        !ledger.scores().values().any(|row| row.contains_key("t0")),
        "and still takes its score with it"
    );

    clear(&pool).await.expect("the cleanup applies");
}
