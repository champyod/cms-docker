use cms_ranking::binding::ServedContest;
use cms_ranking::db::Db;
use cms_ranking::store::{load_ledger, load_standings};
use sqlx::PgPool;
use tokio::sync::oneshot;

/// These need a live PostgreSQL carrying the ranking tables, like the other `db_*` suites: they
/// are ignored by default because a missing database is an environment gap, not a code defect.
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
        "DELETE FROM ranking_subchanges",
        "DELETE FROM ranking_submissions",
        "DELETE FROM ranking_tasks",
        "DELETE FROM ranking_settings",
        "DELETE FROM ranking_overrides",
        "DELETE FROM ranking_hidden",
        "DELETE FROM ranking_users",
        "DELETE FROM ranking_teams",
        "DELETE FROM ranking_contests",
    ];
    for statement in STATEMENTS {
        sqlx::query(statement).execute(pool).await?;
    }
    Ok(())
}

/// One task, one submission, one change worth 40, and a hidden row the build reads last-but-one.
///
/// The hidden row is what lets the test stop a build in the middle: the build reads the config,
/// the users and the overrides, then waits on `ranking_hidden`, which a second connection holds
/// under an exclusive lock. Everything the build has read by then is inside its snapshot.
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
    sqlx::query("INSERT INTO ranking_users (key, f_name, l_name) VALUES ('u0', 'Ada', 'L')")
        .execute(pool)
        .await?;
    sqlx::query("INSERT INTO ranking_submissions (key, \"user\", task, time) VALUES ('s0', 'u0', 't0', 1700001000)")
        .execute(pool)
        .await?;
    sqlx::query("INSERT INTO ranking_subchanges (key, submission, time, score) VALUES ('sc0', 's0', 1700001000, 40.0)")
        .execute(pool)
        .await?;
    Ok(())
}

/// The total the ledger carries for one user, or `None` when the board has no row for them.
fn total_for(ledger: &cms_ranking::scoring::Ledger, user: &str) -> Option<f64> {
    ledger
        .board()
        .iter()
        .find(|row| row.key == user)
        .map(|row| row.score)
}

/// A build must read the board from one point in time.
///
/// WHY the lock and not a sleep: the build is stopped at a statement boundary the test controls,
/// so the write below lands inside the build's read window rather than at a moment the test
/// hoped for. A commit that lands while a build is mid-read is exactly the tear this covers —
/// under read committed the later read sees it and the board serves a total the database never
/// held at any instant.
#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables"]
async fn a_commit_during_a_build_does_not_reach_the_board() {
    let pool = pool();
    seed(&pool).await.expect("the seed applies");

    // The writer that stops the build mid-read, then commits a second change while it waits.
    let mut blocker = pool.acquire().await.expect("a connection").detach();
    sqlx::query("BEGIN")
        .execute(&mut blocker)
        .await
        .expect("begin");
    sqlx::query("LOCK TABLE ranking_hidden IN ACCESS EXCLUSIVE MODE")
        .execute(&mut blocker)
        .await
        .expect("the lock is taken");

    let (locked_tx, locked_rx) = oneshot::channel::<()>();
    let (release_tx, release_rx) = oneshot::channel::<()>();
    let build_pool = pool.clone();
    let build = tokio::spawn(async move {
        let _ = locked_tx.send(());
        let standings = load_standings(&build_pool, ServedContest::EveryContest).await;
        let _ = release_rx.await;
        standings
    });

    locked_rx.await.expect("the build started");
    // Give the build time to reach the lock, so its snapshot is taken and its earlier reads are
    // done. The build cannot pass `ranking_hidden` until the lock above is released.
    tokio::time::sleep(std::time::Duration::from_millis(600)).await;
    assert!(
        !build.is_finished(),
        "the build must be stopped inside its read window, not finished before the write"
    );

    sqlx::query("INSERT INTO ranking_subchanges (key, submission, time, score) VALUES ('sc1', 's0', 1700002000, 90.0)")
        .execute(&pool)
        .await
        .expect("the concurrent change commits");
    sqlx::query("COMMIT")
        .execute(&mut blocker)
        .await
        .expect("commit");
    let _ = release_tx.send(());

    let standings = build
        .await
        .expect("the build finished")
        .expect("the build reads");
    assert_eq!(
        total_for(&standings.ledger, "u0"),
        Some(40.0),
        "the build read both tables from one snapshot: the change committed while it waited is \
         not part of the board it serves"
    );
}

/// The same window, on the ledger entry point: `/scores` must not tear either.
#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables"]
async fn a_commit_during_a_ledger_read_does_not_reach_the_scores() {
    let pool = pool();
    seed(&pool).await.expect("the seed applies");

    let mut blocker = pool.acquire().await.expect("a connection").detach();
    sqlx::query("BEGIN")
        .execute(&mut blocker)
        .await
        .expect("begin");
    sqlx::query("LOCK TABLE ranking_hidden IN ACCESS EXCLUSIVE MODE")
        .execute(&mut blocker)
        .await
        .expect("the lock is taken");

    let (started_tx, started_rx) = oneshot::channel::<()>();
    let (release_tx, release_rx) = oneshot::channel::<()>();
    let build_pool = pool.clone();
    let read = tokio::spawn(async move {
        let _ = started_tx.send(());
        let ledger = load_ledger(&build_pool, ServedContest::EveryContest).await;
        let _ = release_rx.await;
        ledger
    });

    started_rx.await.expect("the read started");
    tokio::time::sleep(std::time::Duration::from_millis(600)).await;
    assert!(
        !read.is_finished(),
        "the read must be stopped inside its window, not finished before the write"
    );

    sqlx::query("INSERT INTO ranking_subchanges (key, submission, time, score) VALUES ('sc1', 's0', 1700002000, 90.0)")
        .execute(&pool)
        .await
        .expect("the concurrent change commits");
    sqlx::query("COMMIT")
        .execute(&mut blocker)
        .await
        .expect("commit");
    let _ = release_tx.send(());

    let ledger = read
        .await
        .expect("the read finished")
        .expect("the read succeeds");
    assert_eq!(
        total_for(&ledger, "u0"),
        Some(40.0),
        "one snapshot for one read"
    );
}

/// Two builds over the same unchanged data return the same board: the snapshot is a read, not a
/// mutation of what the service reports.
#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables"]
async fn a_snapshot_leaves_no_visible_state_behind() {
    let pool = pool();
    seed(&pool).await.expect("the seed applies");

    let first = load_standings(&pool, ServedContest::EveryContest)
        .await
        .expect("a build");
    let second = load_standings(&pool, ServedContest::EveryContest)
        .await
        .expect("a second build");

    assert_eq!(total_for(&first.ledger, "u0"), Some(40.0));
    assert_eq!(total_for(&second.ledger, "u0"), Some(40.0));
    let rows: i64 = sqlx::query_scalar("SELECT count(*) FROM ranking_subchanges")
        .fetch_one(&pool)
        .await
        .expect("a count");
    assert_eq!(rows, 1, "the build wrote nothing");
}
