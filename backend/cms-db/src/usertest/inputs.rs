//! One transaction-scoped read of every database input a user-test compilation
//! or evaluation job needs.
//!
//! [`UserTestInputs`] is the bundle and [`user_test_inputs`] is the only read
//! that fills it. The user test's row and its three named file sets come from
//! the column-exact queries below; the dataset comes from
//! [`crate::dataset_by_id`], its managers from the same read a submission uses,
//! and the contest languages from [`crate::judging::contest_languages`] reached
//! through the test's participation. Nothing here begins or commits a
//! transaction: pass a [`crate::Transaction`]'s connection so every read sees
//! the same snapshot.
//!
//! Unlike the submission read, an absent user test or dataset is a named
//! refusal rather than `None`: a user-test job is built for a row the caller
//! named, so a missing row is a fault in that name rather than an empty read.
//!
//! # Errors
//!
//! [`UserTestInputsError`] keeps a driver refusal, a refusal from one of the
//! shared reads, and a missing named row apart. No database failure is turned
//! into an absent input.

use std::collections::BTreeMap;

use chrono::NaiveDateTime;
use sqlx::postgres::PgConnection;

use crate::digest::FileDigest;
use crate::judging::{contest_languages, named_files, JudgingReadError, MANAGERS_BY_DATASET};
use crate::reads::{DatasetId, DatasetRecord};
use crate::task::dataset_by_id;

use super::UserTest;

/// Every database input a user-test compilation or evaluation job needs for
/// one user test on one dataset.
#[derive(Debug, Clone, PartialEq)]
pub struct UserTestInputs {
    /// The `user_tests` row, read by [`user_test_inputs`].
    pub user_test: UserTest,
    /// The dataset row, read by [`crate::dataset_by_id`]; `task_type_parameters`
    /// is carried as the raw `jsonb` text.
    pub dataset: DatasetRecord,
    /// The dataset's managers, by filename.
    pub managers: BTreeMap<String, FileDigest>,
    /// The managers the user test carries itself, by filename.
    pub user_test_managers: BTreeMap<String, FileDigest>,
    /// The user test's uploaded files, by filename.
    pub files: BTreeMap<String, FileDigest>,
    /// The executables the user test's result holds, by filename.
    pub executables: BTreeMap<String, FileDigest>,
    /// `contests.languages` for the contest the user test's participation is in.
    pub languages: Vec<String>,
}

/// Why the user-test inputs could not be read.
#[derive(Debug, thiserror::Error)]
pub enum UserTestInputsError {
    /// A read the driver refused.
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    /// One of the shared column-exact reads refused a row.
    #[error(transparent)]
    Read(#[from] JudgingReadError),
    /// The named user test has no row.
    #[error("user test {0} does not exist")]
    MissingUserTest(i32),
    /// The named dataset has no row.
    #[error("dataset {0} does not exist")]
    MissingDataset(i32),
}

/// The columns of one `user_tests` row the builder reads.
const USER_TEST_BY_ID: &str = "\
    SELECT id, participation_id, task_id, timestamp, language, input \
    FROM user_tests WHERE id = $1";

/// The `(filename, digest)` rows of one user test's uploaded files.
const USER_TEST_FILES: &str = "\
    SELECT filename, digest FROM user_test_files WHERE user_test_id = $1";

/// The `(filename, digest)` rows of one user test's own managers.
const USER_TEST_MANAGERS: &str = "\
    SELECT filename, digest FROM user_test_managers WHERE user_test_id = $1";

/// The `(filename, digest)` rows of one user test result's executables.
const USER_TEST_EXECUTABLES: &str = "\
    SELECT filename, digest FROM user_test_executables
    WHERE user_test_id = $1 AND dataset_id = $2";

/// A `user_tests` row before its input digest is parsed.
#[derive(Debug, sqlx::FromRow)]
struct UserTestRow {
    id: i32,
    participation_id: i32,
    task_id: i32,
    timestamp: NaiveDateTime,
    language: Option<String>,
    input: String,
}

/// Reads one `user_tests` row, naming the column a refused digest came from.
async fn user_test_row(
    connection: &mut PgConnection,
    user_test_id: i32,
) -> Result<Option<UserTest>, UserTestInputsError> {
    let row = sqlx::query_as::<_, UserTestRow>(USER_TEST_BY_ID)
        .bind(user_test_id)
        .fetch_optional(connection)
        .await?;
    let Some(row) = row else {
        return Ok(None);
    };
    let input = row
        .input
        .parse()
        .map_err(|source| JudgingReadError::Digest("user_tests.input", source))?;
    Ok(Some(UserTest {
        id: row.id,
        participation_id: row.participation_id,
        task_id: row.task_id,
        timestamp: row.timestamp,
        language: row.language,
        input,
    }))
}

/// The four named file sets the two user-test constructors read.
struct UserTestTables {
    managers: BTreeMap<String, FileDigest>,
    user_test_managers: BTreeMap<String, FileDigest>,
    files: BTreeMap<String, FileDigest>,
    executables: BTreeMap<String, FileDigest>,
}

/// Reads the dataset's managers and the user test's own named file sets.
async fn read_user_test_tables(
    connection: &mut PgConnection,
    user_test_id: i32,
    dataset_id: i32,
) -> Result<UserTestTables, UserTestInputsError> {
    let managers = named_files(
        connection,
        MANAGERS_BY_DATASET,
        &[dataset_id],
        "managers.digest",
    )
    .await?;
    let user_test_managers = named_files(
        connection,
        USER_TEST_MANAGERS,
        &[user_test_id],
        "user_test_managers.digest",
    )
    .await?;
    let files = named_files(
        connection,
        USER_TEST_FILES,
        &[user_test_id],
        "user_test_files.digest",
    )
    .await?;
    let executables = named_files(
        connection,
        USER_TEST_EXECUTABLES,
        &[user_test_id, dataset_id],
        "user_test_executables.digest",
    )
    .await?;
    Ok(UserTestTables {
        managers,
        user_test_managers,
        files,
        executables,
    })
}

/// Read every database input one user-test compilation or evaluation job needs.
///
/// Pass a [`crate::Transaction`]'s connection so all reads share one snapshot;
/// this function neither begins nor commits a transaction. A missing user test
/// or dataset is a refusal naming that id, never an empty bundle.
///
/// # Errors
///
/// Returns [`UserTestInputsError::Database`] for a read the driver refused,
/// [`UserTestInputsError::Read`] for a shared read that refused a row, and a
/// missing-name variant when either named row does not exist.
pub async fn user_test_inputs(
    connection: &mut PgConnection,
    user_test_id: i32,
    dataset_id: DatasetId,
) -> Result<UserTestInputs, UserTestInputsError> {
    let Some(user_test) = user_test_row(connection, user_test_id).await? else {
        return Err(UserTestInputsError::MissingUserTest(user_test_id));
    };
    let Some(dataset) = dataset_by_id(connection, dataset_id).await? else {
        return Err(UserTestInputsError::MissingDataset(dataset_id.0));
    };
    let tables = read_user_test_tables(connection, user_test.id, dataset.id.0).await?;
    let languages = contest_languages(connection, user_test.participation_id).await?;
    Ok(UserTestInputs {
        user_test,
        dataset,
        managers: tables.managers,
        user_test_managers: tables.user_test_managers,
        files: tables.files,
        executables: tables.executables,
        languages,
    })
}
