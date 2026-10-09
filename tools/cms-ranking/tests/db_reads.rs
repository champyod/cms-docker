use cms_ranking::db::Db;
use cms_ranking::store::{load_appearance, load_ledger, StoreError};
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
    const STATEMENTS: [&str; 4] = [
        "DELETE FROM ranking_subchanges",
        "DELETE FROM ranking_submissions",
        "DELETE FROM ranking_tasks",
        "DELETE FROM ranking_settings",
    ];
    for statement in STATEMENTS {
        sqlx::query(statement).execute(pool).await?;
    }
    Ok(())
}

/// One task, two submissions for one user, two changes: the second change raises
/// the score, so the history must carry two entries and the board one value.
async fn seed(pool: &PgPool) -> Result<(), sqlx::Error> {
    clear(pool).await?;
    sqlx::query(
        "INSERT INTO ranking_tasks (key, name, short_name, contest, max_score, \
         score_precision, extra_headers, display_order, score_mode) \
         VALUES ('t0', 'Task', 'T0', 'c0', 100.0, 2, '[]'::jsonb, 0, 'max')",
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
    sqlx::query(
        "INSERT INTO ranking_tasks (key, name, short_name, contest, max_score, \
         score_precision, extra_headers, display_order, score_mode) \
         VALUES ('t0', 'Task', 'T0', 'c0', 100.0, 2, '[]'::jsonb, 0, 'not_a_mode')",
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
