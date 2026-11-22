//! The display-name precedence and the name a row shows, against a real server.
//!
//! WHY live: the rule reads three scopes out of the database and the queries are
//! where the precedence is applied. The pure rule is covered without a connection
//! in `username.rs`; these cases prove the queries fill it as the reference's do.
//!
//! RUN: CMS_DB_TEST_URL=postgres://cmsuser:***@127.0.0.1:5432/cmsdb_test \
//!        cargo test -p cms-db --test username_live

use cms_db::{get_display_name, get_display_username, username_config_allowed};

// Each binary that includes this fixture uses a subset of it.
#[allow(dead_code)]
#[path = "support/username_db.rs"]
mod username_db;

use username_db::{at, codename, membership, open, participation, policy, skip, user};

const CONTEST: i32 = 1;
const OTHER_CONTEST: i32 = 2;
const ADA: i32 = 1;

#[tokio::test]
async fn a_contest_policy_decides_for_every_participant() {
    let Some(config) = skip() else {
        return;
    };
    let mut connection = open(&config).await;

    policy(&mut connection, "contest", CONTEST, "allow").await;
    policy(&mut connection, "user", ADA, "deny").await;
    assert!(username_config_allowed(&mut connection, CONTEST, ADA)
        .await
        .expect("the policy lookup runs"));

    policy(&mut connection, "contest", OTHER_CONTEST, "deny").await;
    membership(&mut connection, ADA, 7).await;
    policy(&mut connection, "group", 7, "allow").await;
    assert!(
        !username_config_allowed(&mut connection, OTHER_CONTEST, ADA)
            .await
            .expect("the policy lookup runs")
    );
}

#[tokio::test]
async fn a_user_policy_decides_when_the_contest_has_none() {
    let Some(config) = skip() else {
        return;
    };
    let mut connection = open(&config).await;

    policy(&mut connection, "user", ADA, "allow").await;
    membership(&mut connection, ADA, 7).await;
    policy(&mut connection, "group", 7, "deny").await;
    assert!(username_config_allowed(&mut connection, CONTEST, ADA)
        .await
        .expect("the policy lookup runs"));
}

#[tokio::test]
async fn a_group_deny_beats_a_group_allow_and_no_row_denies() {
    let Some(config) = skip() else {
        return;
    };
    let mut connection = open(&config).await;

    membership(&mut connection, ADA, 7).await;
    membership(&mut connection, ADA, 8).await;
    policy(&mut connection, "group", 7, "allow").await;
    policy(&mut connection, "group", 8, "deny").await;
    assert!(!username_config_allowed(&mut connection, CONTEST, ADA)
        .await
        .expect("the policy lookup runs"));

    assert!(!username_config_allowed(&mut connection, CONTEST, 2)
        .await
        .expect("the policy lookup runs"));
}

#[tokio::test]
async fn the_display_name_is_the_alias_only_when_the_contest_allows_it() {
    let Some(config) = skip() else {
        return;
    };
    let mut connection = open(&config).await;
    let user = user(ADA, "Ada", "Lovelace");

    set_alias(&mut connection, OTHER_CONTEST, ADA, "ada_alias").await;
    assert_eq!(
        get_display_name(&mut connection, OTHER_CONTEST, &user)
            .await
            .expect("the name resolves"),
        "Ada Lovelace",
        "no policy means the alias is not shown"
    );

    policy(&mut connection, "contest", OTHER_CONTEST, "allow").await;
    assert_eq!(
        get_display_name(&mut connection, OTHER_CONTEST, &user)
            .await
            .expect("the name resolves"),
        "ada_alias"
    );
    assert_eq!(
        get_display_username(&mut connection, CONTEST, ADA)
            .await
            .expect("the alias lookup runs"),
        None,
        "an alias belongs to one contest only"
    );

    assert_eq!(
        get_display_name(&mut connection, CONTEST, &user)
            .await
            .expect("the name resolves"),
        "Ada Lovelace"
    );
}

/// One alias row, written the way the migration's columns are ordered.
async fn set_alias(
    connection: &mut sqlx::postgres::PgConnection,
    contest_id: i32,
    user_id: i32,
    username: &str,
) {
    let participation = participation(contest_id, user_id);
    sqlx::query(
        "INSERT INTO contest_usernames \
         (participation_id, contest_id, user_id, username, updated_at) \
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(participation.id)
    .bind(contest_id)
    .bind(user_id)
    .bind(codename(username).as_str())
    .bind(at(10, 0))
    .execute(connection)
    .await
    .expect("inserting an alias row");
}
