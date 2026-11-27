//! The user-test commit against the frozen schema and a real PostgreSQL server.
//!
//! RUN: source /home/ccyod/.hermes/cache/scratch/cms-test-p.env
//!        cargo test -p cms-db --test user_test_commit_live -- --test-threads=1
//!
//! WHY a scratch database: the shared test database is not reset between runs.
//! WHY replica role: the frozen FKs would force seeding grandparent tables the
//! commit never touches; domains, checks and uniques still apply.

#[path = "support/user_test_commit.rs"]
mod support;

use cms_db::{commit_user_test, CommitError, UserTestOperation, UserTestWrite};

use support::{
    assert_compilation_columns, assert_no_evaluation, close, compilation, evaluated_row,
    executable, executables, recorded, require_open, result_row, stored, DATASET, NEW_DIGEST,
    OLD_DIGEST, USER_TEST,
};

#[tokio::test]
async fn a_compilation_writes_every_result_column_and_its_executable_set() {
    let (base, mut connection, name) = require_open().await;
    let write = recorded(compilation([OLD_DIGEST, NEW_DIGEST]));
    let receipts = commit_user_test(&mut connection, &[write])
        .await
        .expect("the compilation commits");
    assert_eq!(receipts.len(), 1, "the batch hands its audit row back");

    let row = stored(&mut connection).await;
    assert_compilation_columns(&row, &result_row());
    assert_no_evaluation(&row);

    let stored = executables(&mut connection).await;
    assert_eq!(stored.len(), 2, "both compiled files are stored");
    assert_eq!(stored[0].filename, "a.out");
    assert_eq!(stored[0].digest, OLD_DIGEST);
    assert_eq!(stored[1].filename, "stub");
    assert_eq!(stored[1].digest, NEW_DIGEST);
    close(base, &name).await;
}

#[tokio::test]
async fn an_evaluation_writes_only_its_own_half_of_the_result() {
    let (base, mut connection, name) = require_open().await;
    commit_user_test(
        &mut connection,
        &[recorded(compilation([OLD_DIGEST, NEW_DIGEST]))],
    )
    .await
    .expect("the compilation commits");
    let prior = cms_db::user_test_result(&mut connection, USER_TEST, cms_db::DatasetId(DATASET))
        .await
        .expect("reading the stored compilation")
        .expect("the result exists");
    let write = UserTestWrite {
        operation: UserTestOperation::Evaluation,
        result: evaluated_row(&prior),
        executables: Vec::new(),
        audit: Vec::new(),
    };
    commit_user_test(&mut connection, &[recorded(write)])
        .await
        .expect("the evaluation commits");

    let row = stored(&mut connection).await;
    assert_compilation_survived(&row);
    assert_eq!(row.output.as_deref(), Some(NEW_DIGEST));
    assert_eq!(row.evaluation_outcome.as_deref(), Some("ok"));
    assert_eq!(row.evaluation_text, vec!["Correct".to_owned()]);
    assert_eq!(row.execution_time, Some(1.5));
    assert_eq!(row.evaluation_shard, Some(3));
    assert_eq!(
        executables(&mut connection).await.len(),
        2,
        "the set is untouched"
    );
    close(base, &name).await;
}

/// The compilation half an evaluation must leave exactly as it found it.
fn assert_compilation_survived(row: &support::Stored) {
    assert_eq!(
        row.compilation_outcome.as_deref(),
        Some("ok"),
        "compilation survived"
    );
    assert_eq!(row.compilation_tries, 1, "the try count survived");
}

#[tokio::test]
async fn a_recompilation_replaces_the_executable_set() {
    let (base, mut connection, name) = require_open().await;
    commit_user_test(
        &mut connection,
        &[recorded(compilation([OLD_DIGEST, NEW_DIGEST]))],
    )
    .await
    .expect("the first compilation commits");
    let replacement = recorded(UserTestWrite {
        executables: vec![executable("a.out", NEW_DIGEST)],
        ..compilation([NEW_DIGEST, NEW_DIGEST])
    });
    commit_user_test(&mut connection, &[replacement])
        .await
        .expect("the recompilation commits");

    let stored = executables(&mut connection).await;
    assert_eq!(stored.len(), 1, "the old executable set was replaced");
    assert_eq!(stored[0].filename, "a.out");
    assert_eq!(stored[0].digest, NEW_DIGEST);
    close(base, &name).await;
}

#[tokio::test]
async fn an_unrecorded_user_test_write_is_refused() {
    let (base, mut connection, name) = require_open().await;
    let error = commit_user_test(&mut connection, &[compilation([OLD_DIGEST, NEW_DIGEST])])
        .await
        .expect_err("an unrecorded write is refused");
    assert!(matches!(error, CommitError::AuditNotWired), "{error:?}");
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM user_test_results")
        .fetch_one(&mut connection)
        .await
        .expect("counting result rows");
    assert_eq!(count, 0, "nothing was written");
    close(base, &name).await;
}
