//! The task-hide causes /diagnostics reports, and the surface that carries them.
//!
//! WHY a live database for the causes: the withheld one is what the projection encodes by
//! omission — the push announced a contest with an empty task set (its only task had no active
//! dataset), so no task row exists and the contest row is the only trace it leaves. What the
//! classification reads is therefore what PostgreSQL returns for the reader's one snapshot
//! statement, which a pure fixture cannot prove.
//!
//! WHY the surface check is not a database test: what must not break is the shape the panel's
//! consumer parses, and that is a property of the serialized response alone.

use cms_ranking::binding::ServedContest;
use cms_ranking::db::Db;
use cms_ranking::http::Diagnostics;
use cms_ranking::store::load_ledger;
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

/// The board shows contest 1, and the projection holds contest `c0` for it — the row the push
/// writes whether or not it announced any task of the contest.
///
/// `task`: the task row to file under `c0`, or None for the withheld case, where the push left
/// the contest's task set empty.
async fn seed_shown_contest(
    pool: &PgPool,
    contest_key: &str,
    task: Option<(&str, &str)>,
) -> Result<(), sqlx::Error> {
    clear(pool).await?;
    sqlx::query("INSERT INTO ranking_config (target_kind, target_key) VALUES ('contest', '1')")
        .execute(pool)
        .await?;
    sqlx::query(
        "INSERT INTO ranking_contests (key, name, begin, \"end\", score_precision, contest_id) \
         VALUES ($1, 'Spring', 1, 2, 0, 1)",
    )
    .bind(contest_key)
    .execute(pool)
    .await?;
    if let Some((key, task_contest)) = task {
        sqlx::query(
            "INSERT INTO ranking_tasks (key, name, short_name, contest, contest_id, max_score, \
             score_precision, extra_headers, display_order, score_mode) \
             VALUES ($1, 'Task', 'task', $2, 1, 100.0, 0, '[]'::jsonb, 0, 'max')",
        )
        .bind(key)
        .bind(task_contest)
        .execute(pool)
        .await?;
    }
    Ok(())
}

/// A task hide spelled the way the picker writes it: the encoded contest, a slash, the task.
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

/// The false alarm this split exists to end: a hide on a task the CMS knows but the projection
/// withholds is reported as withheld, not as the rename the counter exists to catch.
#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables"]
async fn a_hide_on_a_withheld_task_is_reported_as_withheld() {
    let pool = pool();
    seed_shown_contest(&pool, "c0", None)
        .await
        .expect("the seed applies");
    hide_task(&pool, "c0/gone")
        .await
        .expect("the override applies");

    let ledger = load_ledger(&pool, ServedContest::EveryContest)
        .await
        .expect("the ledger assembles");

    assert_eq!(ledger.withheld_task_hides(), 1, "the contest holds no task");
    assert_eq!(ledger.renamed_task_hides(), 0, "nothing was renamed");
    assert_eq!(
        ledger.unmatched_task_hides(),
        0,
        "the snapshot names the contest"
    );
    assert_eq!(
        ledger.unknown_task_hides(),
        1,
        "the counter's own meaning is unchanged: it is the causes, summed"
    );

    clear(&pool).await.expect("the cleanup applies");
}

/// A contest that holds tasks and not the one the hide names is the stale key a rename leaves,
/// and it must keep reporting as the alarm it is.
#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables"]
async fn a_hide_on_a_task_a_live_contest_no_longer_holds_is_reported_as_renamed() {
    let pool = pool();
    seed_shown_contest(&pool, "c0", Some(("t0", "c0")))
        .await
        .expect("the seed applies");
    hide_task(&pool, "c0/stale")
        .await
        .expect("the override applies");

    let ledger = load_ledger(&pool, ServedContest::EveryContest)
        .await
        .expect("the ledger assembles");

    assert_eq!(ledger.renamed_task_hides(), 1, "c0 holds t0 and not stale");
    assert_eq!(
        ledger.withheld_task_hides(),
        0,
        "c0's task set is not empty"
    );
    assert_eq!(
        ledger.unmatched_task_hides(),
        0,
        "the snapshot names the contest"
    );

    clear(&pool).await.expect("the cleanup applies");
}

/// A hide naming a contest the snapshot does not hold at all is the one cause left: nothing in
/// the projection explains the key, and reporting it as withheld would hide a typo.
#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables"]
async fn a_hide_naming_no_projected_contest_is_reported_as_unmatched() {
    let pool = pool();
    seed_shown_contest(&pool, "c0", Some(("t0", "c0")))
        .await
        .expect("the seed applies");
    hide_task(&pool, "c9/gone")
        .await
        .expect("the override applies");

    let ledger = load_ledger(&pool, ServedContest::EveryContest)
        .await
        .expect("the ledger assembles");

    assert_eq!(
        ledger.unmatched_task_hides(),
        1,
        "c9 is not in the snapshot"
    );
    assert_eq!(
        ledger.withheld_task_hides(),
        0,
        "no projected contest was withheld"
    );
    assert_eq!(
        ledger.renamed_task_hides(),
        0,
        "the snapshot holds no task of c9 to be stale against"
    );

    clear(&pool).await.expect("the cleanup applies");
}

/// The panel's consumer parses `ready`, `skipped_overrides` and `skipped_subchanges` and
/// ignores what it does not know, so the split has to be additive: every key it already reads
/// stays, with the meaning it already had, and the causes arrive beside them.
#[test]
fn the_diagnostics_surface_keeps_its_keys_and_adds_the_causes() {
    let body = serde_json::to_value(Diagnostics {
        ready: true,
        skipped_overrides: 1,
        skipped_subchanges: 2,
        unknown_task_hides: 3,
        withheld_task_hides: 1,
        renamed_task_hides: 2,
        unmatched_task_hides: 3,
    })
    .expect("the diagnostics serialize");

    for kept in [
        "ready",
        "skipped_overrides",
        "skipped_subchanges",
        "unknown_task_hides",
    ] {
        assert!(
            body.get(kept).is_some(),
            "{kept} is what the panel already reads and must stay"
        );
    }
    assert_eq!(
        body["unknown_task_hides"], 3,
        "the counter keeps its own meaning: every task hide that named no task row"
    );
    assert_eq!(body["withheld_task_hides"], 1);
    assert_eq!(body["renamed_task_hides"], 2);
    assert_eq!(body["unmatched_task_hides"], 3);
}
