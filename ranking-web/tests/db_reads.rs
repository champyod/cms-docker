use cms_ranking::db::Db;
use cms_ranking::store::{load_appearance, load_board, load_ledger, StoreError};
use sqlx::PgPool;

/// These need a live PostgreSQL carrying the ranking tables. They are ignored by
/// default because a missing database is an environment gap, not a code defect;
/// CI runs them with --include-ignored against a postgres service, after applying
/// the CreateTable migration.
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

/// One task, two submissions for one user, two changes: the second change raises
/// the score, so the history must carry two entries and the board one value.
///
/// The config row is what makes the task drawable: the board shows contest 1 because the
/// config says so, and the task is filed under it by the contest id the projection pushes.
async fn seed(pool: &PgPool) -> Result<(), sqlx::Error> {
    clear(pool).await?;
    sqlx::query("INSERT INTO ranking_config (target_kind, target_key) VALUES ('contest', '1')")
        .execute(pool)
        .await?;
    sqlx::query(
        "INSERT INTO ranking_tasks (key, name, short_name, contest, contest_id, max_score, \
         score_precision, extra_headers, display_order, score_mode) \
         VALUES ('t0', 'Task', 'T0', 'c0', 1, 100.0, 2, '[]'::jsonb, 0, 'max')",
    )
    .execute(pool)
    .await?;
    for (key, time) in [("s0", 1700001000), ("s1", 1700002000)] {
        sqlx::query(
            "INSERT INTO ranking_submissions (key, \"user\", task, time) VALUES ($1, 'u0', 't0', $2)",
        )
        .bind(key)
        .bind(time)
        .execute(pool)
        .await?;
    }
    for (key, submission, time, score) in [
        ("sc0", "s0", 1700001000, 10.0_f64),
        ("sc1", "s1", 1700002000, 40.0_f64),
    ] {
        sqlx::query(
            "INSERT INTO ranking_subchanges (key, submission, time, score) VALUES ($1, $2, $3, $4)",
        )
        .bind(key)
        .bind(submission)
        .bind(time)
        .bind(score)
        .execute(pool)
        .await?;
    }
    Ok(())
}

#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables"]
async fn the_ledger_is_assembled_from_the_tables() {
    let pool = pool();
    seed(&pool).await.expect("the seed applies");
    let ledger = load_ledger(&pool)
        .await
        .expect("the seeded projection assembles");
    assert_eq!(ledger.skipped_subchanges(), 0);
    assert_eq!(
        ledger
            .scores()
            .get("u0")
            .and_then(|row| row.get("t0"))
            .copied(),
        Some(40.0)
    );
    assert_eq!(
        ledger.history(),
        &[
            ("u0".to_string(), "t0".to_string(), 1700001000, 10.0),
            ("u0".to_string(), "t0".to_string(), 1700002000, 40.0),
        ]
    );
}

#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables"]
async fn an_unknown_score_mode_refuses_instead_of_guessing() {
    let pool = pool();
    clear(&pool).await.expect("the tables are reachable");
    // The task has to be inside the board's shown set for the read to reach it at all.
    sqlx::query("INSERT INTO ranking_config (target_kind, target_key) VALUES ('contest', '1')")
        .execute(&pool)
        .await
        .expect("the config row inserts");
    sqlx::query(
        "INSERT INTO ranking_tasks (key, name, short_name, contest, contest_id, max_score, \
         score_precision, extra_headers, display_order, score_mode) \
         VALUES ('t0', 'Task', 'T0', 'c0', 1, 100.0, 2, '[]'::jsonb, 0, 'not_a_mode')",
    )
    .execute(&pool)
    .await
    .expect("the row inserts");
    match load_ledger(&pool).await {
        Err(StoreError::Score(error)) => {
            assert!(error.to_string().contains("not_a_mode"));
        }
        other => panic!("expected a refusal, got {other:?}"),
    }
}

#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables"]
async fn appearance_is_absent_until_the_panel_writes_it() {
    let pool = pool();
    clear(&pool).await.expect("the tables are reachable");
    assert!(load_appearance(&pool)
        .await
        .expect("the read succeeds")
        .is_none());
    sqlx::query(
        "INSERT INTO ranking_settings (id, title, access_mode) VALUES (1, 'Board', 'protected')",
    )
    .execute(&pool)
    .await
    .expect("the row inserts");
    let appearance = load_appearance(&pool)
        .await
        .expect("the read succeeds")
        .expect("the row is there");
    assert_eq!(appearance.title.as_deref(), Some("Board"));
    assert_eq!(appearance.access_mode, "protected");
    assert!(!appearance.show_id_column());
}

/// The board is the ledger's override-shaped rows named from the projection: a rename
/// reaches the reader, the row is ranked by the server, and a hidden row is gone.
#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables"]
async fn the_board_applies_overrides_and_names_the_rows() {
    let pool = pool();
    clear(&pool).await.expect("the tables are reachable");
    // The config row and the task's contest id are what put the task inside the board's shown
    // set: the read is scoped by the config now, so a fixture without them draws nothing.
    sqlx::query("INSERT INTO ranking_config (target_kind, target_key) VALUES ('contest', '1')")
        .execute(&pool)
        .await
        .expect("the config row inserts");
    sqlx::query(
        "INSERT INTO ranking_users (key, f_name, l_name, team) VALUES \
         ('u0', 'Grace', 'Hopper', NULL), ('u1', 'Alan', 'Turing', NULL)",
    )
    .execute(&pool)
    .await
    .expect("the users insert");
    sqlx::query(
        "INSERT INTO ranking_tasks (key, name, short_name, contest, contest_id, max_score, \
         score_precision, extra_headers, display_order, score_mode) \
         VALUES ('t0', 'Task', 'T0', 'c0', 1, 100.0, 0, '[]'::jsonb, 0, 'max')",
    )
    .execute(&pool)
    .await
    .expect("the task inserts");
    sqlx::query(
        "INSERT INTO ranking_submissions (key, \"user\", task, time) VALUES \
         ('s0', 'u0', 't0', 1), ('s1', 'u1', 't0', 1)",
    )
    .execute(&pool)
    .await
    .expect("the submissions insert");
    sqlx::query(
        "INSERT INTO ranking_subchanges (key, submission, time, score) VALUES \
         ('c0', 's0', 2, 10.0), ('c1', 's1', 2, 30.0)",
    )
    .execute(&pool)
    .await
    .expect("the subchanges insert");
    sqlx::query(
        "INSERT INTO ranking_overrides (contest_id, target_kind, target_key, action, payload, reason) \
         VALUES (1, 'user', 'u0', 'rename', '{\"value\": \"Ada Lovelace\"}'::jsonb, 'e2e'), \
                (1, 'user', 'u1', 'hide', NULL, 'e2e')",
    )
    .execute(&pool)
    .await
    .expect("the overrides insert");
    let board = load_board(&pool).await.expect("the board assembles");
    assert_eq!(board["u0"].f_name, "Ada");
    assert_eq!(board["u0"].l_name, "Lovelace");
    assert_eq!(board["u0"].score, 10.0);
    assert_eq!(board["u0"].rank, 1);
    assert!(
        !board.contains_key("u1"),
        "a hidden row leaves the board the page draws"
    );
}

/// The trigger, not the writer, is what makes the board live; this is the only place
/// the trigger is exercised as a trigger rather than as a migration that applied.
#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables and triggers"]
async fn a_projection_write_notifies_listeners() {
    let pool = pool();
    let mut listener = sqlx::postgres::PgListener::connect_with(&pool)
        .await
        .expect("a listener connects");
    listener
        .listen("ranking_entities")
        .await
        .expect("the channel is listened on");
    sqlx::query("INSERT INTO ranking_teams (key, name) VALUES ('notify_probe', 'Probe')")
        .execute(&pool)
        .await
        .expect("the write commits");
    let notification = tokio::time::timeout(std::time::Duration::from_secs(5), listener.recv())
        .await
        .expect("a notification arrives before the timeout")
        .expect("the notification reads");
    assert_eq!(notification.channel(), "ranking_entities");
    assert!(
        notification.payload().starts_with("ranking_teams "),
        "the payload names the table: {}",
        notification.payload()
    );
    sqlx::query("DELETE FROM ranking_teams WHERE key = 'notify_probe'")
        .execute(&pool)
        .await
        .expect("the probe is removed");
}
