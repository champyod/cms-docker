//! The user-test half of a judging commit: the result row, its executable set,
//! and the statement that writes them.
//!
//! `user_test_results` has no evaluation rows and no score columns: its
//! `evaluation_text`, `evaluation_outcome` and the execution figures live on the
//! result row itself (`src/cms/db/usertest.py:241-495`). The shape below mirrors
//! that row column for column, in statement order, so a value the table would
//! refuse never reaches a query. The executables are written as one array-bound
//! statement, in the same style as the submission executable set.
//!
//! Nothing here opens a transaction: [`commit_user_test`] owns that, and hands
//! the batch's audit rows back to the caller rather than storing unchained rows.

use crate::digest::FileDigest;
use crate::usertest::{Filename, FilenameError};

use super::batch::AuditRow;
use super::commit::CommitError;

/// The `user_test_results` columns one user-test operation writes, upserted on
/// the `(user_test_id, dataset_id)` key the reference looks the row up by.
pub const UPSERT_USER_TEST_RESULT: &str = "\
    INSERT INTO user_test_results (user_test_id, dataset_id, output, \
        compilation_outcome, compilation_text, compilation_tries, \
        compilation_stdout, compilation_stderr, compilation_time, \
        compilation_wall_clock_time, compilation_memory, compilation_shard, \
        compilation_sandbox_paths, compilation_sandbox_digests, \
        evaluation_outcome, evaluation_text, evaluation_tries, execution_time, \
        execution_wall_clock_time, execution_memory, evaluation_shard, \
        evaluation_sandbox_paths, evaluation_sandbox_digests) \
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, \
        $15, $16, $17, $18, $19, $20, $21, $22, $23) \
    ON CONFLICT (user_test_id, dataset_id) DO UPDATE SET \
        output = EXCLUDED.output, \
        compilation_outcome = EXCLUDED.compilation_outcome, \
        compilation_text = EXCLUDED.compilation_text, \
        compilation_tries = EXCLUDED.compilation_tries, \
        compilation_stdout = EXCLUDED.compilation_stdout, \
        compilation_stderr = EXCLUDED.compilation_stderr, \
        compilation_time = EXCLUDED.compilation_time, \
        compilation_wall_clock_time = EXCLUDED.compilation_wall_clock_time, \
        compilation_memory = EXCLUDED.compilation_memory, \
        compilation_shard = EXCLUDED.compilation_shard, \
        compilation_sandbox_paths = EXCLUDED.compilation_sandbox_paths, \
        compilation_sandbox_digests = EXCLUDED.compilation_sandbox_digests, \
        evaluation_outcome = EXCLUDED.evaluation_outcome, \
        evaluation_text = EXCLUDED.evaluation_text, \
        evaluation_tries = EXCLUDED.evaluation_tries, \
        execution_time = EXCLUDED.execution_time, \
        execution_wall_clock_time = EXCLUDED.execution_wall_clock_time, \
        execution_memory = EXCLUDED.execution_memory, \
        evaluation_shard = EXCLUDED.evaluation_shard, \
        evaluation_sandbox_paths = EXCLUDED.evaluation_sandbox_paths, \
        evaluation_sandbox_digests = EXCLUDED.evaluation_sandbox_digests";

/// The `user_test_executables` columns one compilation produces, one bound
/// array per column so the whole set lands in one statement.
pub const INSERT_USER_TEST_EXECUTABLES: &str = "\
    INSERT INTO user_test_executables (user_test_id, dataset_id, filename, digest) \
    SELECT * FROM unnest($1::integer[], $2::integer[], $3::varchar[], $4::varchar[])";

/// The one statement a recompilation clears its predecessor's executables with.
pub const DELETE_USER_TEST_EXECUTABLES: &str =
    "DELETE FROM user_test_executables WHERE user_test_id = $1 AND dataset_id = $2";

/// One row of `user_test_results` as the statement binds it.
#[derive(Debug, Clone, PartialEq)]
pub struct UserTestResultRow {
    /// `user_test_results.user_test_id`, bound as `$1`.
    pub user_test_id: i32,
    /// `user_test_results.dataset_id`, bound as `$2`.
    pub dataset_id: i32,
    /// `user_test_results.output`, the digest an evaluation wrote.
    pub output: Option<FileDigest>,
    /// `user_test_results.compilation_outcome`, absent until compilation ends.
    pub compilation_outcome: Option<String>,
    /// `user_test_results.compilation_text`, the localized compiler output.
    pub compilation_text: Vec<String>,
    /// `user_test_results.compilation_tries`.
    pub compilation_tries: i32,
    /// `user_test_results.compilation_stdout`.
    pub compilation_stdout: Option<String>,
    /// `user_test_results.compilation_stderr`.
    pub compilation_stderr: Option<String>,
    /// `user_test_results.compilation_time`, in seconds.
    pub compilation_time: Option<f64>,
    /// `user_test_results.compilation_wall_clock_time`, in seconds.
    pub compilation_wall_clock_time: Option<f64>,
    /// `user_test_results.compilation_memory`, in bytes.
    pub compilation_memory: Option<i64>,
    /// `user_test_results.compilation_shard`.
    pub compilation_shard: Option<i32>,
    /// `user_test_results.compilation_sandbox_paths`.
    pub compilation_sandbox_paths: Option<Vec<String>>,
    /// `user_test_results.compilation_sandbox_digests`.
    pub compilation_sandbox_digests: Option<Vec<String>>,
    /// `user_test_results.evaluation_outcome`, absent until evaluation ends.
    pub evaluation_outcome: Option<String>,
    /// `user_test_results.evaluation_text`, the localized grader output.
    pub evaluation_text: Vec<String>,
    /// `user_test_results.evaluation_tries`.
    pub evaluation_tries: i32,
    /// `user_test_results.execution_time`, in seconds.
    pub execution_time: Option<f64>,
    /// `user_test_results.execution_wall_clock_time`, in seconds.
    pub execution_wall_clock_time: Option<f64>,
    /// `user_test_results.execution_memory`, in bytes.
    pub execution_memory: Option<i64>,
    /// `user_test_results.evaluation_shard`.
    pub evaluation_shard: Option<i32>,
    /// `user_test_results.evaluation_sandbox_paths`.
    pub evaluation_sandbox_paths: Option<Vec<String>>,
    /// `user_test_results.evaluation_sandbox_digests`.
    pub evaluation_sandbox_digests: Option<Vec<String>>,
}

impl UserTestResultRow {
    /// The row before either half ran: absent outcomes, empty texts, zero tries.
    #[must_use]
    pub fn new(user_test_id: i32, dataset_id: i32) -> Self {
        Self {
            user_test_id,
            dataset_id,
            output: None,
            compilation_outcome: None,
            compilation_text: Vec::new(),
            compilation_tries: 0,
            compilation_stdout: None,
            compilation_stderr: None,
            compilation_time: None,
            compilation_wall_clock_time: None,
            compilation_memory: None,
            compilation_shard: None,
            compilation_sandbox_paths: None,
            compilation_sandbox_digests: None,
            evaluation_outcome: None,
            evaluation_text: Vec::new(),
            evaluation_tries: 0,
            execution_time: None,
            execution_wall_clock_time: None,
            execution_memory: None,
            evaluation_shard: None,
            evaluation_sandbox_paths: None,
            evaluation_sandbox_digests: None,
        }
    }
}

/// One file a user-test compilation produced. `id` draws its own value, and the
/// unique key is carried by the owning pair and the filename.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserTestExecutableRow {
    /// The owning result's `user_test_id`.
    pub user_test_id: i32,
    /// The owning result's `dataset_id`.
    pub dataset_id: i32,
    /// `user_test_executables.filename`, unique within the owning result.
    pub filename: Filename,
    /// `user_test_executables.digest`, the identity of the stored file.
    pub digest: FileDigest,
}

impl UserTestExecutableRow {
    /// Applies the `FILENAME` domain and the `DIGEST` domain before the row can
    /// be bound, so a value the table would refuse is refused here.
    ///
    /// # Errors
    ///
    /// Returns [`FilenameError`] when `filename` violates the domain.
    pub fn new(
        user_test_id: i32,
        dataset_id: i32,
        filename: &str,
        digest: FileDigest,
    ) -> Result<Self, FilenameError> {
        let filename = Filename::parse(filename)?;
        Ok(Self {
            user_test_id,
            dataset_id,
            filename,
            digest,
        })
    }
}

/// Which half of a user-test commit one write belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UserTestOperation {
    /// `USER_TEST_COMPILATION`: replace the executable set and the result.
    Compilation,
    /// `USER_TEST_EVALUATION`: write the evaluation figures on the result.
    Evaluation,
}

/// The rows one user test writes for one dataset.
#[derive(Debug, Clone, PartialEq)]
pub struct UserTestWrite {
    /// Which half of the commit these rows came from.
    pub operation: UserTestOperation,
    /// The result row the operation's figures land on.
    pub result: UserTestResultRow,
    /// The executable set a compilation produced.
    pub executables: Vec<UserTestExecutableRow>,
    /// The rows the change is recorded as. A write needs at least one.
    pub audit: Vec<AuditRow>,
}

impl UserTestWrite {
    /// Refuses a write that would reach the database unrecorded.
    ///
    /// # Errors
    ///
    /// Returns [`CommitError::AuditNotWired`] when no audit row was declared.
    pub fn seal(self) -> Result<Self, CommitError> {
        if self.audit.is_empty() {
            return Err(CommitError::AuditNotWired);
        }
        Ok(self)
    }
}

/// Write grouped user-test operations in one transaction, returning their audit
/// rows for the caller to append through the writer that computes the chain.
///
/// A compilation clears the old executable set before inserting the new one,
/// just as the reference replaces the set when an executable is rebuilt. An
/// evaluation leaves the set alone. Neither writes an evaluation row or a score.
///
/// # Errors
///
/// Returns [`CommitError::AuditNotWired`] for an unrecorded write and
/// [`CommitError::Database`] for a statement the driver refused.
pub async fn commit_user_test(
    connection: &mut sqlx::postgres::PgConnection,
    writes: &[UserTestWrite],
) -> Result<Vec<AuditRow>, CommitError> {
    use sqlx::Connection;

    let mut transaction = connection.begin().await?;
    for write in writes {
        let write = write.clone().seal()?;
        write_result(&mut transaction, &write.result).await?;
        if write.operation == UserTestOperation::Compilation {
            delete_executables(&mut transaction, &write.result).await?;
            insert_executables(&mut transaction, &write).await?;
        }
    }
    transaction.commit().await?;
    Ok(writes
        .iter()
        .flat_map(|write| write.audit.iter().cloned())
        .collect())
}

async fn write_result(
    connection: &mut sqlx::postgres::PgConnection,
    row: &UserTestResultRow,
) -> Result<(), sqlx::Error> {
    sqlx::query(UPSERT_USER_TEST_RESULT)
        .bind(row.user_test_id)
        .bind(row.dataset_id)
        .bind(row.output.as_ref().map(FileDigest::to_string))
        .bind(row.compilation_outcome.as_deref())
        .bind(row.compilation_text.clone())
        .bind(row.compilation_tries)
        .bind(row.compilation_stdout.as_deref())
        .bind(row.compilation_stderr.as_deref())
        .bind(row.compilation_time)
        .bind(row.compilation_wall_clock_time)
        .bind(row.compilation_memory)
        .bind(row.compilation_shard)
        .bind(row.compilation_sandbox_paths.clone())
        .bind(row.compilation_sandbox_digests.clone())
        .bind(row.evaluation_outcome.as_deref())
        .bind(row.evaluation_text.clone())
        .bind(row.evaluation_tries)
        .bind(row.execution_time)
        .bind(row.execution_wall_clock_time)
        .bind(row.execution_memory)
        .bind(row.evaluation_shard)
        .bind(row.evaluation_sandbox_paths.clone())
        .bind(row.evaluation_sandbox_digests.clone())
        .execute(&mut *connection)
        .await?;
    Ok(())
}

async fn delete_executables(
    connection: &mut sqlx::postgres::PgConnection,
    row: &UserTestResultRow,
) -> Result<(), sqlx::Error> {
    sqlx::query(DELETE_USER_TEST_EXECUTABLES)
        .bind(row.user_test_id)
        .bind(row.dataset_id)
        .execute(&mut *connection)
        .await?;
    Ok(())
}

async fn insert_executables(
    connection: &mut sqlx::postgres::PgConnection,
    write: &UserTestWrite,
) -> Result<(), sqlx::Error> {
    if write.executables.is_empty() {
        return Ok(());
    }
    let mut user_tests = Vec::with_capacity(write.executables.len());
    let mut datasets = Vec::with_capacity(write.executables.len());
    let mut filenames = Vec::with_capacity(write.executables.len());
    let mut digests = Vec::with_capacity(write.executables.len());
    for row in &write.executables {
        user_tests.push(row.user_test_id);
        datasets.push(row.dataset_id);
        filenames.push(row.filename.as_str().to_owned());
        digests.push(row.digest.to_string());
    }
    sqlx::query(INSERT_USER_TEST_EXECUTABLES)
        .bind(user_tests)
        .bind(datasets)
        .bind(filenames)
        .bind(digests)
        .execute(&mut *connection)
        .await?;
    Ok(())
}
