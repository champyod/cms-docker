//! The digest walk against a real server: every table, every skip, and the scope.
//!
//! RUN: CMS_DB_TEST_URL=postgres://cmsuser:***@127.0.0.1:5432/cmsdb_test \
//!        cargo test -p cms-db --test reads_walk_live

use std::collections::BTreeSet;

use cms_db::{enumerate_files, get_contest_list, Contest, FileDigest, FileSkips};
use sqlx::postgres::PgConnection;
use sqlx::AssertSqlSafe;

// Each binary that includes this fixture uses a subset of it.
#[allow(dead_code)]
#[path = "support/util_db.rs"]
mod util_db;

use util_db::{digest, open, seed_datasets, skip, OTHER_CONTEST};

/// Run one statement the fixture wrote, binding nothing.
async fn execute(connection: &mut PgConnection, statement: &'static str) {
    sqlx::raw_sql(AssertSqlSafe(statement))
        .execute(&mut *connection)
        .await
        .expect("seeding the fixture");
}

#[tokio::test]
async fn the_walk_visits_every_table_and_honours_each_skip() {
    let Some(url) = skip() else {
        return;
    };
    let mut connection = open(&url).await;
    seed_datasets(&mut connection).await;
    seed_files(&mut connection).await;

    let all = enumerate_files(&mut connection, None, FileSkips::default())
        .await
        .expect("walking every contest");
    assert_eq!(all, digests(1..=13), "the full walk");

    let skipped_users = walk(
        &mut connection,
        FileSkips {
            users: true,
            ..FileSkips::default()
        },
    )
    .await;
    assert_eq!(
        skipped_users,
        digests((1..=5).chain(13..=13)),
        "the walk without users"
    );

    let skipped_submissions = walk(
        &mut connection,
        FileSkips {
            submissions: true,
            ..FileSkips::default()
        },
    )
    .await;
    assert_eq!(skipped_submissions, digests((1..=5).chain(8..=13)));

    let skipped_user_tests = walk(
        &mut connection,
        FileSkips {
            user_tests: true,
            ..FileSkips::default()
        },
    )
    .await;
    assert_eq!(skipped_user_tests, digests((1..=7).chain(13..=13)));

    let skipped_generated = walk(
        &mut connection,
        FileSkips {
            generated: true,
            ..FileSkips::default()
        },
    )
    .await;
    assert_eq!(
        skipped_generated,
        digests((1..=6).chain(8..=10).chain(13..=13))
    );
}

#[tokio::test]
async fn a_contest_scope_walks_only_that_contests_tasks() {
    let Some(url) = skip() else {
        return;
    };
    let mut connection = open(&url).await;
    seed_datasets(&mut connection).await;
    seed_files(&mut connection).await;
    let contest = contest(&mut connection, OTHER_CONTEST).await;

    let walked = enumerate_files(&mut connection, Some(&contest), FileSkips::default())
        .await
        .expect("walking one contest");

    assert_eq!(walked, digests(13..=13), "the other contest's own task");
}

/// One walk with the skips given, over every contest.
async fn walk(connection: &mut PgConnection, skips: FileSkips) -> BTreeSet<FileDigest> {
    enumerate_files(connection, None, skips)
        .await
        .expect("walking every contest")
}

/// The contest the scope test passes in, read back through the same list call.
async fn contest(connection: &mut PgConnection, id: i32) -> Contest {
    get_contest_list(connection)
        .await
        .expect("reading the contests")
        .into_iter()
        .find(|contest| contest.id == id)
        .expect("the contest the fixture seeded")
}

/// One digest in every branch of the walk, plus a duplicate and a tombstone.
async fn seed_files(connection: &mut PgConnection) {
    for statement in [
        "INSERT INTO submissions (id, task_id, participation_id) VALUES (1000, 10, 100)",
        "INSERT INTO submission_results (submission_id, dataset_id) VALUES (1000, 20)",
        "INSERT INTO statements (id, task_id, digest) VALUES (1, 10, '0000000000000000000000000000000000000001'), \
            (2, 10, '0000000000000000000000000000000000000001')",
        "INSERT INTO attachments (id, task_id, digest) VALUES (1, 10, '0000000000000000000000000000000000000002'), \
            (2, 10, 'x')",
        "INSERT INTO managers (id, dataset_id, digest) VALUES (1, 20, '0000000000000000000000000000000000000003')",
        "INSERT INTO testcases (id, dataset_id, input, output) VALUES \
            (1, 20, '0000000000000000000000000000000000000004', '0000000000000000000000000000000000000005')",
        "INSERT INTO files (id, submission_id, digest) VALUES (1, 1000, '0000000000000000000000000000000000000006')",
        "INSERT INTO executables (id, submission_id, dataset_id, digest) VALUES \
            (1, 1000, 20, '0000000000000000000000000000000000000007')",
        "INSERT INTO user_tests (id, task_id, input) VALUES (200, 10, '0000000000000000000000000000000000000008')",
        "INSERT INTO user_test_files (id, user_test_id, digest) VALUES \
            (1, 200, '0000000000000000000000000000000000000009')",
        "INSERT INTO user_test_managers (id, user_test_id, digest) VALUES \
            (1, 200, '000000000000000000000000000000000000000a')",
        "INSERT INTO user_test_results (user_test_id, dataset_id, output) VALUES \
            (200, 20, '000000000000000000000000000000000000000b')",
        "INSERT INTO user_test_executables (id, user_test_id, dataset_id, digest) VALUES \
            (1, 200, 20, '000000000000000000000000000000000000000c')",
        "INSERT INTO statements (id, task_id, digest) VALUES \
            (3, 11, '000000000000000000000000000000000000000d')",
    ] {
        execute(connection, statement).await;
    }
}

/// The digests a set of fixture values names.
fn digests(values: impl IntoIterator<Item = u8>) -> BTreeSet<FileDigest> {
    values.into_iter().map(digest).collect()
}
