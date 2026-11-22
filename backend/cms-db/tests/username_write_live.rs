//! Setting, renaming and removing an alias, and the history each change appends.
//!
//! WHY live: the three orderings the reference fixes are visible only in the rows
//! that survive — an unchanged name appending nothing, a removal logging a NULL
//! username before the row goes, and a refusal leaving the history untouched.
//!
//! RUN: CMS_DB_TEST_URL=postgres://cmsuser:***@127.0.0.1:5432/cmsdb_test \
//!        cargo test -p cms-db --test username_write_live

use cms_db::{set_display_username, UsernameError};

// Each binary that includes this fixture uses a subset of it.
#[allow(dead_code)]
#[path = "support/username_db.rs"]
mod username_db;

use username_db::{at, codename, open, participation, skip};

const CONTEST: i32 = 1;
const OTHER_CONTEST: i32 = 2;
const ADA: i32 = 1;
const GRACE: i32 = 2;
const ADMIN: i32 = 9;

#[tokio::test]
async fn setting_an_alias_writes_the_row_and_one_history_entry() {
    let Some(config) = skip() else {
        return;
    };
    let mut connection = open(&config).await;
    let participation = participation(CONTEST, ADA);

    let row = set_display_username(
        &mut connection,
        &participation,
        Some(&codename("ada")),
        at(10, 0),
        Some(ADMIN),
    )
    .await
    .expect("the alias is written")
    .expect("setting returns the row");

    assert_eq!(row.username, codename("ada"));
    assert_eq!(row.contest_id, CONTEST);
    assert_eq!(row.user_id, ADA);
    assert_eq!(row.participation_id, participation.id);
    assert_eq!(row.updated_at, at(10, 0));
    assert_eq!(row.updated_by_admin_id, Some(ADMIN));
    assert_eq!(count(&mut connection, "contest_usernames").await, 1);
    assert_eq!(count(&mut connection, "contest_usernames_history").await, 1);
}

#[tokio::test]
async fn renaming_appends_history_and_the_same_name_appends_nothing() {
    let Some(config) = skip() else {
        return;
    };
    let mut connection = open(&config).await;
    let participation = participation(CONTEST, ADA);

    set(&mut connection, &participation, "ada", at(10, 0)).await;
    set(&mut connection, &participation, "ada_l", at(10, 5)).await;
    assert_eq!(count(&mut connection, "contest_usernames_history").await, 2);

    let again = set(&mut connection, &participation, "ada_l", at(11, 0)).await;
    assert_eq!(
        again.updated_at,
        at(10, 5),
        "an unchanged name is not a change"
    );
    assert_eq!(
        count(&mut connection, "contest_usernames_history").await,
        2,
        "an unchanged name appends no history row"
    );
}

#[tokio::test]
async fn removing_appends_a_null_username_entry_and_deletes_the_row() {
    let Some(config) = skip() else {
        return;
    };
    let mut connection = open(&config).await;
    let participation = participation(CONTEST, ADA);

    set_display_username(
        &mut connection,
        &participation,
        Some(&codename("ada")),
        at(10, 0),
        None,
    )
    .await
    .expect("the alias is written");

    let removed = set_display_username(
        &mut connection,
        &participation,
        None,
        at(12, 0),
        Some(ADMIN),
    )
    .await
    .expect("the alias is removed");
    assert!(removed.is_none(), "removal returns no row");
    assert_eq!(count(&mut connection, "contest_usernames").await, 0);
    assert_eq!(count(&mut connection, "contest_usernames_history").await, 2);

    let last: Option<String> = sqlx::query_scalar(
        "SELECT username FROM contest_usernames_history ORDER BY id DESC LIMIT 1",
    )
    .fetch_one(&mut connection)
    .await
    .expect("reading the last history row");
    assert_eq!(last, None, "a removal is logged with a NULL username");
}

#[tokio::test]
async fn a_name_another_user_holds_in_the_same_contest_is_refused() {
    let Some(config) = skip() else {
        return;
    };
    let mut connection = open(&config).await;

    set_display_username(
        &mut connection,
        &participation(CONTEST, ADA),
        Some(&codename("shared")),
        at(10, 0),
        None,
    )
    .await
    .expect("the first user takes the name");

    let refusal = set_display_username(
        &mut connection,
        &participation(CONTEST, GRACE),
        Some(&codename("shared")),
        at(10, 1),
        None,
    )
    .await
    .expect_err("the name belongs to another user");
    assert!(matches!(refusal, UsernameError::Taken));
    assert_eq!(
        refusal.to_string(),
        "Display username already taken in this contest"
    );
    assert_eq!(
        count(&mut connection, "contest_usernames_history").await,
        1,
        "a refused write appends no history row"
    );

    set_display_username(
        &mut connection,
        &participation(OTHER_CONTEST, GRACE),
        Some(&codename("shared")),
        at(10, 2),
        None,
    )
    .await
    .expect("the same name is free in another contest");
}

/// How many rows a table holds in this connection's temp schema.
async fn count(connection: &mut sqlx::postgres::PgConnection, table: &'static str) -> i64 {
    sqlx::query_scalar(sqlx::AssertSqlSafe(format!("SELECT count(*) FROM {table}")))
        .fetch_one(connection)
        .await
        .expect("counting fixture rows")
}

/// Set a name on behalf of no admin, returning the row the table holds.
async fn set(
    connection: &mut sqlx::postgres::PgConnection,
    participation: &cms_db::Participation,
    username: &str,
    timestamp: chrono::NaiveDateTime,
) -> cms_db::DisplayUsername {
    set_display_username(
        connection,
        participation,
        Some(&codename(username)),
        timestamp,
        None,
    )
    .await
    .expect("the alias is written")
    .expect("setting returns the row")
}
