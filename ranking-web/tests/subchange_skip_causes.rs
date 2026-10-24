//! The skipped-row causes /diagnostics reports, asserted against a live projection.
//!
//! WHY a live database for the causes: what the fold drops is a fact about the pair of rows
//! PostgreSQL returns for the task snapshot and the submissions — a hidden contest's tasks are
//! in the snapshot and out of the replay set, a task nothing announced is in neither — so the
//! classification is only proven by the rows the reader actually gets.
//!
//! WHY the cause and not only the total: one number covered four causes and two units, so the
//! operator's own hide (a concealed contest moved it 40 → 466 on prod) read exactly like a data
//! fault. These tests pin each cause to the row shape that produces it.

use cms_ranking::binding::ServedContest;
use cms_ranking::db::Db;
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

/// The board draws contest 1, the projection files task `t0` under `c0`, and one scored
/// submission of `u0` sits on it. That is the healthy shape every cause below departs from.
async fn seed_scored_task(pool: &PgPool) -> Result<(), sqlx::Error> {
    clear(pool).await?;
    sqlx::query("INSERT INTO ranking_config (target_kind, target_key) VALUES ('contest', '1')")
        .execute(pool)
        .await?;
    sqlx::query(
        "INSERT INTO ranking_contests (key, name, begin, \"end\", score_precision, contest_id) \
         VALUES ('c0', 'Spring', 1, 2, 0, 1)",
    )
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

/// The baseline the causes are read against: a drawn, unhidden task drops nothing, so every
/// counter is zero. Without this the tests below could pass on a ledger that drops everything.
#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables"]
async fn a_healthy_board_drops_nothing() {
    let pool = pool();
    seed_scored_task(&pool).await.expect("the seed applies");

    let ledger = load_ledger(&pool, ServedContest::EveryContest)
        .await
        .expect("the ledger assembles");

    assert_eq!(
        ledger.skipped_subchanges(),
        0,
        "nothing is dropped when every task a submission names is drawn"
    );
    assert_eq!(ledger.hidden_task_subchanges(), 0);
    assert_eq!(ledger.unknown_task_subchanges(), 0);
    assert_eq!(ledger.orphan_subchanges(), 0);

    clear(&pool).await.expect("the cleanup applies");
}

/// The prod signature: hiding a contest drops the tasks inside it, and the submissions on those
/// tasks leave the board with them. That is the operator's own doing, so it is reported as the
/// hide cause — the old fold counted it as a fault (466 rows) while exempting a hidden *task*.
#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables"]
async fn a_hidden_contest_is_reported_as_the_hide_cause() {
    let pool = pool();
    seed_scored_task(&pool).await.expect("the seed applies");
    sqlx::query(
        "INSERT INTO ranking_overrides (contest_id, target_kind, target_key, action, payload, reason) \
         VALUES (1, 'contest', 'c0', 'hide', NULL, 'day one is over')",
    )
    .execute(&pool)
    .await
    .expect("the override applies");

    let ledger = load_ledger(&pool, ServedContest::EveryContest)
        .await
        .expect("the ledger assembles");

    assert_eq!(
        ledger.hidden_task_subchanges(),
        1,
        "the concealed contest took its task's submission with it, and said so"
    );
    assert_eq!(
        ledger.unknown_task_subchanges(),
        0,
        "the projection announces t0, so nothing about this row is unexplained"
    );
    assert_eq!(
        ledger.orphan_subchanges(),
        0,
        "its subchange left with the submission rather than on its own"
    );
    assert_eq!(
        ledger.skipped_subchanges(),
        1,
        "the total counts the dropped row once, under its one cause"
    );

    clear(&pool).await.expect("the cleanup applies");
}

/// The fault the counter exists for: a submission naming a task no drawn contest announces. The
/// push never carried it, or it belongs to a contest this instance does not draw.
#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables"]
async fn a_submission_for_a_task_nothing_announced_is_the_fault_cause() {
    let pool = pool();
    seed_scored_task(&pool).await.expect("the seed applies");
    sqlx::query(
        "INSERT INTO ranking_submissions (key, \"user\", task, time) VALUES ('s9', 'u0', 't9', 3)",
    )
    .execute(&pool)
    .await
    .expect("the orphaned submission applies");

    let ledger = load_ledger(&pool, ServedContest::EveryContest)
        .await
        .expect("the ledger assembles");

    assert_eq!(
        ledger.unknown_task_subchanges(),
        1,
        "no hide and no announcement explains s9"
    );
    assert_eq!(
        ledger.hidden_task_subchanges(),
        0,
        "nothing was hidden here"
    );

    clear(&pool).await.expect("the cleanup applies");
}

/// The other fault: a subchange naming a submission the projection does not hold at all. It is
/// counted as its own cause rather than folded into the submissions' one, because the two need
/// different fixes — a missing submission row is not a missing task.
#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables"]
async fn a_subchange_with_no_submission_row_is_the_orphan_cause() {
    let pool = pool();
    seed_scored_task(&pool).await.expect("the seed applies");
    sqlx::query(
        "INSERT INTO ranking_subchanges (key, submission, time, score) VALUES ('c9', 's9', 3, 10.0)",
    )
    .execute(&pool)
    .await
    .expect("the orphaned subchange applies");

    let ledger = load_ledger(&pool, ServedContest::EveryContest)
        .await
        .expect("the ledger assembles");

    assert_eq!(
        ledger.orphan_subchanges(),
        1,
        "c9 names a submission nothing pushed"
    );
    assert_eq!(
        ledger.unknown_task_subchanges(),
        0,
        "every submission that exists is on a drawn task"
    );

    clear(&pool).await.expect("the cleanup applies");
}

/// The three causes partition the total: a board carrying all three at once reports the same
/// number in `skipped_subchanges` as the causes sum to, so an operator adding the breakdown up
/// never finds a row that belongs to none of them.
#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables"]
async fn the_causes_partition_the_total() {
    let pool = pool();
    seed_scored_task(&pool).await.expect("the seed applies");
    // A hidden task: t0 is announced and out of the replay set.
    sqlx::query(
        "INSERT INTO ranking_overrides (contest_id, target_kind, target_key, action, payload, reason) \
         VALUES (1, 'task', 'c0/t0', 'hide', NULL, 'task withdrawn')",
    )
    .execute(&pool)
    .await
    .expect("the task hide applies");
    // A submission for a task nothing announced.
    sqlx::query(
        "INSERT INTO ranking_submissions (key, \"user\", task, time) VALUES ('s9', 'u0', 't9', 3)",
    )
    .execute(&pool)
    .await
    .expect("the unannounced submission applies");
    // A subchange naming no submission.
    sqlx::query(
        "INSERT INTO ranking_subchanges (key, submission, time, score) VALUES ('c9', 'sX', 3, 10.0)",
    )
    .execute(&pool)
    .await
    .expect("the orphan subchange applies");

    let ledger = load_ledger(&pool, ServedContest::EveryContest)
        .await
        .expect("the ledger assembles");

    assert_eq!(ledger.hidden_task_subchanges(), 1, "the task hide");
    assert_eq!(ledger.unknown_task_subchanges(), 1, "the unannounced task");
    assert_eq!(ledger.orphan_subchanges(), 1, "the orphan subchange");
    assert_eq!(
        ledger.skipped_subchanges(),
        ledger.hidden_task_subchanges()
            + ledger.unknown_task_subchanges()
            + ledger.orphan_subchanges(),
        "the causes are a partition, not three more counters"
    );

    clear(&pool).await.expect("the cleanup applies");
}
