//! A contest hidden by an override: the contest leaves the board's contest list and every
//! task filed under it leaves the task list and the ledger together, while the contest and
//! its task keep their own rows and metadata. The task hide is scoped to the contest its
//! composite key names, so another contest keeps its tasks.
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

/// Two contests, each with one scored task and one contestant, and no override yet. The
/// tasks are filed under distinct contests so a hide that names one leaves the other.
async fn seed_two_contests(pool: &PgPool) -> Result<(), sqlx::Error> {
    clear(pool).await?;
    sqlx::query("INSERT INTO ranking_config (target_kind, target_key) VALUES ('contest', '1')")
        .execute(pool)
        .await?;
    // The contest list is scoped by the shown set against `ranking_contests.contest_id`, the
    // CMS contest id the projection pushes beside the encoded name, so a seeded contest without
    // one is not in any board's shown set — the reader refuses to invent a scope for it.
    sqlx::query(
        "INSERT INTO ranking_contests (key, name, begin, \"end\", score_precision, contest_id) VALUES \
         ('c0', 'Spring', 1, 2, 0, 1), ('c1', 'Autumn', 1, 2, 0, 1)",
    )
    .execute(pool)
    .await?;
    sqlx::query(
        "INSERT INTO ranking_users (key, f_name, l_name, team) VALUES \
         ('u0', 'Ada', 'Lovelace', NULL), ('u1', 'Alan', 'Turing', NULL)",
    )
    .execute(pool)
    .await?;
    sqlx::query(
        "INSERT INTO ranking_tasks (key, name, short_name, contest, contest_id, max_score, \
         score_precision, extra_headers, display_order, score_mode) VALUES \
         ('t0', 'A Plus B', 'aplusb', 'c0', 1, 100.0, 0, '[]'::jsonb, 0, 'max'), \
         ('t1', 'Two Sum', 'twosum', 'c1', 1, 100.0, 0, '[]'::jsonb, 1, 'max')",
    )
    .execute(pool)
    .await?;
    sqlx::query(
        "INSERT INTO ranking_submissions (key, \"user\", task, time) VALUES \
         ('s0', 'u0', 't0', 1), ('s1', 'u1', 't1', 1)",
    )
    .execute(pool)
    .await?;
    sqlx::query(
        "INSERT INTO ranking_subchanges (key, submission, time, score) VALUES \
         ('sc0', 's0', 2, 30.0), ('sc1', 's1', 2, 50.0)",
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// A contest hide: the key is the encoded contest name the projection files tasks under.
async fn hide_contest(pool: &PgPool, key: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO ranking_overrides (contest_id, target_kind, target_key, action, payload, reason) \
         VALUES (1, 'contest', $1, 'hide', NULL, 'contest withdrawn')",
    )
    .bind(key)
    .execute(pool)
    .await?;
    Ok(())
}

/// A task hide spelled as the picker writes it: the encoded contest, a slash, the task.
async fn hide_task(pool: &PgPool, key: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO ranking_overrides (contest_id, target_kind, target_key, action, payload, reason) \
         VALUES (1, 'task', $1, 'hide', NULL, 'task withdrawn')",
    )
    .bind(key)
    .execute(pool)
    .await?;
    Ok(())
}

/// The shown set the seed puts both contests inside; the reader's own scope comes from the
/// config, and the route reads the same one.
fn shown() -> ShownSet {
    ShownSet::new(vec![1])
}

async fn listed(pool: &PgPool, kind: Kind) -> serde_json::Value {
    let body = list_body(pool, kind, &shown())
        .await
        .expect("the entity list renders");
    serde_json::from_slice(&body).expect("the entity list is json")
}

async fn listed_contests(pool: &PgPool) -> serde_json::Value {
    listed(pool, Kind::Contest).await
}

async fn listed_tasks(pool: &PgPool) -> serde_json::Value {
    listed(pool, Kind::Task).await
}

/// The contest hide is the group: the contest leaves the contest list and every task filed
/// under it leaves the task list and the ledger, while another contest and its task stay.
#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables"]
async fn a_hidden_contest_leaves_the_column_and_the_ledger_together() {
    let pool = pool();
    seed_two_contests(&pool).await.expect("the seed applies");
    hide_contest(&pool, "c0")
        .await
        .expect("the override applies");

    let contests = listed_contests(&pool).await;
    assert!(
        contests.get("c0").is_none(),
        "the hidden contest leaves the contest list"
    );
    assert!(
        contests.get("c1").is_some(),
        "the contest that was not hidden stays"
    );

    let tasks = listed_tasks(&pool).await;
    assert!(
        tasks.get("t0").is_none(),
        "the hidden contest's task leaves the task list"
    );
    assert!(
        tasks.get("t1").is_some(),
        "another contest's task stays, and this is what the group hide must not drop"
    );

    let ledger = load_ledger(&pool, ServedContest::EveryContest)
        .await
        .expect("the ledger assembles");
    assert!(
        !ledger.scores().values().any(|row| row.contains_key("t0")),
        "the hidden contest's task leaves the score grid"
    );
    assert!(
        ledger.history().iter().all(|entry| entry.1 != "t0"),
        "the hidden contest's task leaves the history"
    );
    assert_eq!(
        ledger.scores().get("u1").and_then(|row| row.get("t1")),
        Some(&50.0),
        "another contest's task still scores"
    );
    assert!(
        !ledger.board().iter().any(|row| row.key == "u0"),
        "a contestant whose only task is hidden is not ranked"
    );
    assert!(
        ledger.board().iter().any(|row| row.key == "u1"),
        "a contestant of the other contest stays ranked"
    );

    let kept_contest: Option<(String,)> =
        sqlx::query_as("SELECT name FROM ranking_contests WHERE key = 'c0'")
            .fetch_optional(&pool)
            .await
            .expect("the contest row is readable");
    assert_eq!(
        kept_contest,
        Some(("Spring".to_string(),)),
        "the contest keeps its row: a hide is a projection, never a delete"
    );

    let kept_task: Option<(String, String, String)> =
        sqlx::query_as("SELECT name, contest, score_mode FROM ranking_tasks WHERE key = 't0'")
            .fetch_optional(&pool)
            .await
            .expect("the task row is readable");
    assert_eq!(
        kept_task,
        Some(("A Plus B".to_string(), "c0".to_string(), "max".to_string())),
        "the task keeps its row and its metadata"
    );

    clear(&pool).await.expect("the cleanup applies");
}

/// The composite key buys a contest-scoped task hide: a key that names a contest drops the
/// task there, and a task of another contest keeps its column even when the key carries the
/// same task name under the wrong contest.
#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables"]
async fn a_task_hide_is_scoped_to_the_contest_its_key_names() {
    let pool = pool();
    seed_two_contests(&pool).await.expect("the seed applies");
    hide_task(&pool, "c0/t0")
        .await
        .expect("the override applies");

    let tasks = listed_tasks(&pool).await;
    assert!(
        tasks.get("t0").is_none(),
        "the task hidden in its own contest leaves the column list"
    );
    assert!(
        tasks.get("t1").is_some(),
        "the other contest keeps its task"
    );

    let ledger = load_ledger(&pool, ServedContest::EveryContest)
        .await
        .expect("the ledger assembles");
    assert!(
        !ledger.scores().values().any(|row| row.contains_key("t0")),
        "the hidden task leaves the score grid"
    );
    assert_eq!(
        ledger.scores().get("u1").and_then(|row| row.get("t1")),
        Some(&50.0),
        "the other contest's task still scores"
    );

    clear(&pool).await.expect("the cleanup applies");
}

/// The contest half of the key is matched, not ignored: a composite key that names the
/// wrong contest for a task hides nothing there, which a bare task name could not express.
#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables"]
async fn a_task_hide_naming_another_contest_hides_nothing() {
    let pool = pool();
    seed_two_contests(&pool).await.expect("the seed applies");
    // t0 is filed under c0; a key naming c1 must leave it alone.
    hide_task(&pool, "c1/t0")
        .await
        .expect("the override applies");

    let tasks = listed_tasks(&pool).await;
    assert!(
        tasks.get("t0").is_some(),
        "the task is not hidden under a contest it is not filed under"
    );
    assert!(tasks.get("t1").is_some(), "and neither is any other");

    clear(&pool).await.expect("the cleanup applies");
}

/// A contest is a group and not a row, so every verb but hide names something a contest
/// cannot have: the row is refused and hides nothing rather than folding into the board.
#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables"]
async fn a_non_hide_contest_row_hides_nothing() {
    let pool = pool();
    seed_two_contests(&pool).await.expect("the seed applies");
    sqlx::query(
        "INSERT INTO ranking_overrides (contest_id, target_kind, target_key, action, payload, reason) \
         VALUES (1, 'contest', 'c0', 'rename', '{\"value\": \"Renamed\"}'::jsonb, 'nonsense')",
    )
    .execute(&pool)
    .await
    .expect("the override applies");

    let contests = listed_contests(&pool).await;
    assert!(
        contests.get("c0").is_some(),
        "a refused contest row leaves the contest in place"
    );
    let tasks = listed_tasks(&pool).await;
    assert!(
        tasks.get("t0").is_some(),
        "and leaves the contest's tasks in place"
    );

    clear(&pool).await.expect("the cleanup applies");
}
