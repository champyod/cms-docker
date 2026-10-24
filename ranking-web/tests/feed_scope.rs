//! What the feed may announce: an entity event reaches an open page only when the board draws
//! the entity it names (item R1, the publication boundary).
//!
//! WHY a live database: the answer to "does the board draw this key" is a predicate over the
//! projection and the shown set, so the behaviour under test is what PostgreSQL returns rather
//! than a property a pure test can assert. The announcement itself is driven through
//! [`cms_ranking::feed::announce`] — the listener's per-notification step — because a test that
//! waited on NOTIFY's delivery would be racing the notifier instead of testing the rule.

use cms_ranking::config::RankingConfig;
use cms_ranking::db::Db;
use cms_ranking::feed::announce;
use cms_ranking::AppState;
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

fn app() -> AppState {
    AppState::new(
        Some(Db::connect_lazy(&database_url()).expect("a valid database url")),
        RankingConfig::default(),
        None,
    )
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

/// Two contests projected side by side, and the config naming only the first: contest 7 is the
/// board, contest 8 is the day the operator is not showing. Each has its own task, NUL team and
/// one participant, which is the whole leak in one seed — every entity of contest 8 is a row the
/// board must never announce.
async fn seed_two_contests(pool: &PgPool) -> Result<(), sqlx::Error> {
    clear(pool).await?;
    sqlx::query(
        "INSERT INTO ranking_contests (key, name, begin, \"end\", score_precision, contest_id) \
         VALUES ('c7', 'Day One', 1, 2, 0, 7), ('c8', 'Day Two', 3, 4, 0, 8)",
    )
    .execute(pool)
    .await?;
    sqlx::query(
        "INSERT INTO ranking_tasks (key, name, short_name, contest, contest_id, max_score, \
         score_precision, extra_headers, display_order, score_mode) VALUES \
         ('t7', 'Shown Task', 'T7', 'c7', 7, 100.0, 0, '[]'::jsonb, 0, 'max'), \
         ('t8', 'Unshown Task', 'T8', 'c8', 8, 100.0, 0, '[]'::jsonb, 1, 'max')",
    )
    .execute(pool)
    .await?;
    sqlx::query(
        "INSERT INTO ranking_teams (key, name) VALUES ('team7', 'Shown Team'), \
         ('team8', 'Unshown Team')",
    )
    .execute(pool)
    .await?;
    sqlx::query(
        "INSERT INTO ranking_users (key, f_name, l_name, team) VALUES \
         ('u7', 'Ada', 'Shown', 'team7'), ('u8', 'Alan', 'Unshown', 'team8')",
    )
    .execute(pool)
    .await?;
    sqlx::query(
        "INSERT INTO ranking_submissions (key, \"user\", task, time) VALUES \
         ('s7', 'u7', 't7', 1), ('s8', 'u8', 't8', 1)",
    )
    .execute(pool)
    .await?;
    sqlx::query("INSERT INTO ranking_config (target_kind, target_key) VALUES ('contest', '7')")
        .execute(pool)
        .await?;
    Ok(())
}

/// The events one announcement published, as `name data` pairs.
async fn announced_events(state: &AppState, pool: &PgPool, payload: &str) -> Vec<String> {
    let before = state.feed().cached().len();
    announce(state, pool, "ranking_entities", payload)
        .await
        .expect("the announcement is made against a reachable projection");
    state
        .feed()
        .cached()
        .into_iter()
        .skip(before)
        .map(|event| format!("{} {}", event.name, event.data))
        .collect()
}

#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables"]
async fn a_change_to_a_shown_contest_is_announced() {
    let pool = pool();
    seed_two_contests(&pool).await.expect("the seed applies");
    let state = app();

    assert_eq!(
        announced_events(&state, &pool, "ranking_contests update c7").await,
        vec!["contest update c7".to_string()],
        "the contest the config shows is the board's to announce"
    );

    clear(&pool).await.expect("the cleanup applies");
}

#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables"]
async fn a_change_to_a_contest_the_board_does_not_show_is_not_announced() {
    let pool = pool();
    seed_two_contests(&pool).await.expect("the seed applies");
    let state = app();

    assert!(
        announced_events(&state, &pool, "ranking_contests update c8")
            .await
            .is_empty(),
        "a change to another day's contest must not reach a page drawing this one"
    );

    clear(&pool).await.expect("the cleanup applies");
}

#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables"]
async fn a_task_is_announced_only_inside_a_shown_contest() {
    let pool = pool();
    seed_two_contests(&pool).await.expect("the seed applies");
    let state = app();

    assert_eq!(
        announced_events(&state, &pool, "ranking_tasks insert t7").await,
        vec!["task create t7".to_string()],
        "the shown contest's task keeps the event the page switches on"
    );
    assert!(
        announced_events(&state, &pool, "ranking_tasks insert t8")
            .await
            .is_empty(),
        "a task of a contest the board does not show is not the page's to hear"
    );

    clear(&pool).await.expect("the cleanup applies");
}

#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables"]
async fn a_user_is_announced_only_when_a_shown_contest_draws_them() {
    let pool = pool();
    seed_two_contests(&pool).await.expect("the seed applies");
    let state = app();

    assert_eq!(
        announced_events(&state, &pool, "ranking_users update u7").await,
        vec!["user update u7".to_string()],
        "a user with a submission on the shown board is announced"
    );
    assert!(
        announced_events(&state, &pool, "ranking_users update u8")
            .await
            .is_empty(),
        "a user only the unshown contest draws is not"
    );

    clear(&pool).await.expect("the cleanup applies");
}

/// A team carries no contest of its own, so its scope is the members the board draws through it
/// — the same join the team board aggregates. Both halves are asserted because a filter that
/// dropped every team would pass the second assertion alone.
#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables"]
async fn a_team_is_announced_only_when_a_member_of_it_is_on_a_shown_board() {
    let pool = pool();
    seed_two_contests(&pool).await.expect("the seed applies");
    let state = app();

    assert_eq!(
        announced_events(&state, &pool, "ranking_teams update team7").await,
        vec!["team update team7".to_string()],
        "a team the shown board draws is announced"
    );
    assert!(
        announced_events(&state, &pool, "ranking_teams update team8")
            .await
            .is_empty(),
        "a team only the unshown contest draws is not"
    );

    clear(&pool).await.expect("the cleanup applies");
}

/// A tombstone is a change to the user it hides, so it is scoped by whether the board draws that
/// user — not by the contest the tombstone was filed against alone.
#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables"]
async fn a_tombstone_is_announced_as_the_user_it_takes_off_the_board() {
    let pool = pool();
    seed_two_contests(&pool).await.expect("the seed applies");
    let state = app();

    assert_eq!(
        announced_events(&state, &pool, "ranking_hidden insert u7").await,
        vec!["user create u7".to_string()],
        "a hide of a drawn user is a user event"
    );
    assert!(
        announced_events(&state, &pool, "ranking_hidden insert u8")
            .await
            .is_empty(),
        "a tombstone for a user the board does not draw is not"
    );

    clear(&pool).await.expect("the cleanup applies");
}

/// The one case the projection cannot scope: the notifier reports the key of a row that is
/// already gone. It is announced anyway, because the page may be drawing the entity and has no
/// other way to learn it left — a delete it never hears strands a column. The read side still
/// refuses the key, so nothing renders either way.
#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables"]
async fn a_delete_is_announced_even_though_the_scope_can_no_longer_be_read() {
    let pool = pool();
    seed_two_contests(&pool).await.expect("the seed applies");
    sqlx::query("DELETE FROM ranking_tasks WHERE key = 't7'")
        .execute(&pool)
        .await
        .expect("the task is deleted");
    let state = app();

    assert_eq!(
        announced_events(&state, &pool, "ranking_tasks delete t7").await,
        vec!["task delete t7".to_string()],
        "a deleted row of the shown contest is announced from its key alone"
    );

    clear(&pool).await.expect("the cleanup applies");
}

#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables"]
async fn a_score_table_publishes_no_entity_event() {
    let pool = pool();
    seed_two_contests(&pool).await.expect("the seed applies");
    let state = app();

    assert!(
        announced_events(&state, &pool, "ranking_submissions insert s7")
            .await
            .is_empty(),
        "a submission moves scores and names nothing the page reads as an entity"
    );

    clear(&pool).await.expect("the cleanup applies");
}

/// A config change is what moves the shown set, so it is published on the control channel that
/// asks the page to refetch the whole board rather than one row.
#[tokio::test]
#[ignore = "requires a live postgres carrying the ranking tables"]
async fn a_control_change_is_published_as_control() {
    let pool = pool();
    seed_two_contests(&pool).await.expect("the seed applies");
    let state = app();

    announce(&state, &pool, "ranking_control", "ranking_config insert")
        .await
        .expect("the announcement is made against a reachable projection");
    let events: Vec<String> = state
        .feed()
        .cached()
        .into_iter()
        .map(|event| format!("{} {}", event.name, event.data))
        .collect();
    assert_eq!(events, vec!["control ranking_config insert".to_string()]);

    clear(&pool).await.expect("the cleanup applies");
}
