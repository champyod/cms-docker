//! One transaction-scoped read of every database input a submission compilation
//! or evaluation job needs.
//!
//! [`SubmissionInputs`] is the bundle and [`submission_inputs`] is the only read
//! that fills it. Records that already have a public read come from those reads:
//! the submission from [`crate::Submission::get`], the result from
//! [`crate::Submission::get_result`] (which is also where a dataset of another
//! task is refused), the dataset from [`crate::dataset_by_id`], and the testcases
//! from [`crate::testcases_by_dataset`]. The four tables with no existing read —
//! `managers`, `files`, `executables`, and `contests.languages` reached through
//! `participations.contest_id` — are read by the column-exact queries below.
//!
//! Names map onto [`FileDigest`] values in a [`BTreeMap`] so their order is
//! deterministic. Nothing here begins or commits a transaction: pass a
//! [`crate::Transaction`]'s connection so every read sees the same snapshot.
//!
//! # Errors
//!
//! [`JudgingError`] keeps three refusals distinct: a read the driver refused, a
//! [`crate::SubmissionError`] from the submission reads, and a
//! [`JudgingReadError`] from the four new reads. No database failure is turned
//! into an absent input.

use std::collections::BTreeMap;

use sqlx::postgres::PgConnection;

use crate::digest::{DigestError, FileDigest};
use crate::reads::{testcases_by_dataset, DatasetId, DatasetRecord, SubmissionId, TestcaseRecord};
use crate::submission::{Submission, SubmissionError, SubmissionResult};
use crate::task::dataset_by_id;

/// Every database input a submission compilation or evaluation job needs for
/// one submission on one dataset.
#[derive(Debug, Clone, PartialEq)]
pub struct SubmissionInputs {
    /// The submission row, read by [`crate::Submission::get`].
    pub submission: Submission,
    /// The dataset row, read by [`crate::dataset_by_id`]; `task_type_parameters`
    /// is carried as the raw `jsonb` text.
    pub dataset: DatasetRecord,
    /// Every testcase of the dataset, read by [`crate::testcases_by_dataset`].
    pub testcases: Vec<TestcaseRecord>,
    /// The dataset's managers, by filename.
    pub managers: BTreeMap<String, FileDigest>,
    /// The submission's uploaded files, by filename.
    pub files: BTreeMap<String, FileDigest>,
    /// The submission's result on the dataset, absent when no row exists yet.
    pub result: Option<SubmissionResult>,
    /// The executables the result produced, by filename; empty with no result.
    pub executables: BTreeMap<String, FileDigest>,
    /// `contests.languages` for the contest the submission's participation is in.
    pub languages: Vec<String>,
}

/// Why the judging inputs could not be read.
///
/// The three refusals stay distinct so a caller can tell a driver failure, a
/// submission-side refusal, and a failure in one of the new reads apart. A
/// missing submission or dataset is not an error: [`submission_inputs`] returns
/// `Ok(None)` for those.
#[derive(Debug, thiserror::Error)]
pub enum JudgingError {
    /// A read the driver refused (`dataset_by_id` / `testcases_by_dataset`).
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    /// [`crate::Submission::get`] or [`crate::Submission::get_result`] refused,
    /// including [`crate::SubmissionError::DatasetOfAnotherTask`].
    #[error(transparent)]
    Submission(#[from] SubmissionError),
    /// One of the four new column-exact reads refused a row.
    #[error(transparent)]
    Read(#[from] JudgingReadError),
}

/// Why one of the judging-specific reads refused a row.
#[derive(Debug, thiserror::Error)]
pub enum JudgingReadError {
    /// A statement the driver refused.
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    /// A `DIGEST` column held a value the domain would have refused.
    #[error("{0} is not a digest: {1}")]
    Digest(&'static str, #[source] DigestError),
    /// The languages read resolved to other than exactly one contest row.
    #[error("expected one contest language row, found {found}")]
    LanguageRows {
        /// How many rows the query returned.
        found: usize,
    },
}

/// The `(dataset_id, filename, digest)` rows of one dataset's managers.
pub(crate) const MANAGERS_BY_DATASET: &str = "\
    SELECT filename, digest FROM managers WHERE dataset_id = $1";

/// The `(submission_id, filename, digest)` rows of one submission's files.
const FILES_BY_SUBMISSION: &str = "\
    SELECT filename, digest FROM files WHERE submission_id = $1";

/// The `(submission_id, dataset_id, filename, digest)` rows of one result's
/// executables.
const EXECUTABLES_BY_RESULT: &str = "\
    SELECT filename, digest FROM executables
    WHERE submission_id = $1 AND dataset_id = $2";

/// `contests.languages`, reached through `participations.contest_id` for the
/// one participation a submission names.
const LANGUAGES_BY_PARTICIPATION: &str = "\
    SELECT c.languages
    FROM participations AS p
    JOIN contests AS c ON c.id = p.contest_id
    WHERE p.id = $1";

/// A `(filename, digest)` row before the digest is parsed.
#[derive(Debug, sqlx::FromRow)]
struct NamedFileRow {
    filename: String,
    digest: String,
}

/// Parses each row's `digest`, naming the column a refused value came from.
fn digest_map(
    column: &'static str,
    rows: Vec<NamedFileRow>,
) -> Result<BTreeMap<String, FileDigest>, JudgingReadError> {
    let mut map = BTreeMap::new();
    for row in rows {
        let digest = row
            .digest
            .parse()
            .map_err(|source| JudgingReadError::Digest(column, source))?;
        map.insert(row.filename, digest);
    }
    Ok(map)
}

/// Runs one column-exact named-file query with its bound keys.
pub(crate) async fn named_files(
    connection: &mut PgConnection,
    sql: &'static str,
    keys: &[i32],
    column: &'static str,
) -> Result<BTreeMap<String, FileDigest>, JudgingReadError> {
    let mut query = sqlx::query_as::<_, NamedFileRow>(sql);
    for key in keys {
        query = query.bind(*key);
    }
    let rows = query.fetch_all(connection).await?;
    digest_map(column, rows)
}

/// Reads the one contest's languages a participation reaches.
pub async fn contest_languages(
    connection: &mut PgConnection,
    participation_id: i32,
) -> Result<Vec<String>, JudgingReadError> {
    let rows = sqlx::query_scalar::<_, Vec<String>>(LANGUAGES_BY_PARTICIPATION)
        .bind(participation_id)
        .fetch_all(connection)
        .await?;
    match rows.as_slice() {
        [only] => Ok(only.clone()),
        other => Err(JudgingReadError::LanguageRows { found: other.len() }),
    }
}

/// The records read from the tables that have no public read.
struct JudgingTables {
    testcases: Vec<TestcaseRecord>,
    managers: BTreeMap<String, FileDigest>,
    files: BTreeMap<String, FileDigest>,
    executables: BTreeMap<String, FileDigest>,
    languages: Vec<String>,
}

/// Reads the four tables with no public read for one submission and dataset.
///
/// # Errors
///
/// Returns [`JudgingError::Database`] for a read the driver refused and
/// [`JudgingError::Read`] for a new read that refused a row.
async fn read_judging_tables(
    connection: &mut PgConnection,
    submission: &Submission,
    dataset: &DatasetRecord,
) -> Result<JudgingTables, JudgingError> {
    let testcases = testcases_by_dataset(connection, dataset.id).await?;
    let managers = named_files(
        connection,
        MANAGERS_BY_DATASET,
        &[dataset.id.0],
        "managers.digest",
    )
    .await?;
    let files = named_files(
        connection,
        FILES_BY_SUBMISSION,
        &[submission.record.id.0],
        "files.digest",
    )
    .await?;
    let executables = named_files(
        connection,
        EXECUTABLES_BY_RESULT,
        &[submission.record.id.0, dataset.id.0],
        "executables.digest",
    )
    .await?;
    let languages = contest_languages(connection, submission.record.participation_id).await?;
    Ok(JudgingTables {
        testcases,
        managers,
        files,
        executables,
        languages,
    })
}

/// Read every database input one submission compilation or evaluation job needs.
///
/// Pass a [`crate::Transaction`]'s connection so all reads share one snapshot;
/// this function neither begins nor commits a transaction. Returns `Ok(None)`
/// when the submission or the dataset is absent.
///
/// # Errors
///
/// Returns [`JudgingError::Database`] for a read the driver refused,
/// [`JudgingError::Submission`] for a [`crate::SubmissionError`] (including a
/// dataset of another task, refused by [`crate::Submission::get_result`]), and
/// [`JudgingError::Read`] for a new read that refused a row. A database failure
/// is never turned into `None`.
pub async fn submission_inputs(
    connection: &mut PgConnection,
    submission_id: SubmissionId,
    dataset_id: DatasetId,
) -> Result<Option<SubmissionInputs>, JudgingError> {
    let Some(submission) = Submission::get(connection, submission_id).await? else {
        return Ok(None);
    };
    let Some(dataset) = dataset_by_id(connection, dataset_id).await? else {
        return Ok(None);
    };
    let result = submission.get_result(connection, Some(&dataset)).await?;
    let tables = read_judging_tables(connection, &submission, &dataset).await?;
    Ok(Some(SubmissionInputs {
        submission,
        dataset,
        result,
        testcases: tables.testcases,
        managers: tables.managers,
        files: tables.files,
        executables: tables.executables,
        languages: tables.languages,
    }))
}
