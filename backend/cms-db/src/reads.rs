//! Judging reads: the record each entity is read as, and the query behind it.
//!
//! Each entity is a column-exact SQL constant, the record its row maps onto, and
//! the mapping between them. The testcase list is the one shape the reference
//! reads as a dict and this reads as a vector, so its order stays the database's
//! exactly as the reference query leaves it.
//!
//! Nothing here opens a connection, and no query names a column the record beside
//! it does not declare.
//!
//! # Errors
//!
//! [`ReadError`] is the only error a mapping produces, and only
//! [`testcase_from_row`] returns it: a `DIGEST` column holding a value the domain
//! would refuse. The other three mappings are total, because every column they
//! read is already the type their record declares — the outcome and active flags
//! are computed by the projection rather than parsed out of text.

use std::fmt;

use chrono::NaiveDateTime;

use crate::digest::{DigestError, FileDigest};

/// Why a row could not be mapped onto the record beside it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReadError {
    /// A `DIGEST` column held a value the domain would have refused: the column
    /// it was read from, and the rule it broke.
    Digest(&'static str, DigestError),
}

impl fmt::Display for ReadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Digest(column, source) => write!(f, "{column} is not a digest: {source}"),
        }
    }
}

impl std::error::Error for ReadError {}

/// The composite primary key of `submission_results`, in the order its query
/// binds it: `submission_id` as `$1`, `dataset_id` as `$2`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ResultKey {
    /// `submission_results.submission_id`.
    pub submission_id: i32,
    /// `submission_results.dataset_id`.
    pub dataset_id: i32,
}

/// The columns one `submissions` row is read with, bound to its own id as `$1`.
pub const SUBMISSION_BY_ID: &str = "\
    SELECT s.id, s.task_id, s.participation_id, s.timestamp, s.language, s.official
    FROM submissions AS s
    WHERE s.id = $1";

/// A submission as judging holds it: which task, which contestant, and when.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubmissionRecord {
    /// `submissions.id`.
    pub id: i32,
    /// `submissions.task_id`, the task the submission is on.
    pub task_id: i32,
    /// `submissions.participation_id`, the contestant who sent it.
    pub participation_id: i32,
    /// `submissions.timestamp`, a time without a zone as the column stores it.
    pub timestamp: NaiveDateTime,
    /// `submissions.language`, absent when the task takes no language.
    pub language: Option<String>,
    /// `submissions.official`, false when the row is left out of the score.
    pub official: bool,
}

/// Maps the columns [`SUBMISSION_BY_ID`] names onto the record.
#[must_use]
pub const fn submission_from_row(
    id: i32,
    task_id: i32,
    participation_id: i32,
    timestamp: NaiveDateTime,
    language: Option<String>,
    official: bool,
) -> SubmissionRecord {
    SubmissionRecord {
        id,
        task_id,
        participation_id,
        timestamp,
        language,
        official,
    }
}

/// The columns one `submission_results` row is read with, bound to its key.
pub const RESULT_BY_SUBMISSION_AND_DATASET: &str = "\
    SELECT r.submission_id, r.dataset_id,
           r.compilation_outcome IS NOT NULL AS is_compiled,
           r.compilation_outcome = 'ok' AS is_compilation_succeeded,
           r.compilation_tries,
           r.evaluation_outcome IS NOT NULL AS is_evaluated,
           r.evaluation_tries
    FROM submission_results AS r
    WHERE r.submission_id = $1 AND r.dataset_id = $2";

/// One result: how far compilation and evaluation have got, and what they cost.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ResultRecord {
    /// `submission_results.submission_id`.
    pub submission_id: i32,
    /// `submission_results.dataset_id`, the dataset the result belongs to.
    pub dataset_id: i32,
    /// `SubmissionResult.compiled()`: an outcome is recorded at all.
    pub is_compiled: bool,
    /// `SubmissionResult.compilation_succeeded()`: that outcome is `ok`.
    pub is_compilation_succeeded: bool,
    /// `submission_results.compilation_tries`, the failures so far.
    pub compilation_tries: i32,
    /// `SubmissionResult.evaluated()`: an outcome is recorded at all.
    pub is_evaluated: bool,
    /// `submission_results.evaluation_tries`, the failures so far.
    pub evaluation_tries: i32,
}

/// Maps the columns [`RESULT_BY_SUBMISSION_AND_DATASET`] names onto the record.
#[must_use]
pub const fn result_from_row(
    key: ResultKey,
    is_compiled: bool,
    is_compilation_succeeded: bool,
    compilation_tries: i32,
    is_evaluated: bool,
    evaluation_tries: i32,
) -> ResultRecord {
    ResultRecord {
        submission_id: key.submission_id,
        dataset_id: key.dataset_id,
        is_compiled,
        is_compilation_succeeded,
        compilation_tries,
        is_evaluated,
        evaluation_tries,
    }
}

/// The columns one `datasets` row is read with, bound to its own id as `$1`.
///
/// `tasks.active_dataset_id` is nullable and `=` against it is `NULL` rather than
/// false, so the flag is spelled `IS NOT DISTINCT FROM` to give the false
/// `Dataset.active` returns for a task with no active dataset.
pub const DATASET_BY_ID: &str = "\
    SELECT d.id, d.task_id, d.task_type, d.time_limit, d.memory_limit,
           t.active_dataset_id IS NOT DISTINCT FROM d.id AS is_active
    FROM datasets AS d
    JOIN tasks AS t ON t.id = d.task_id
    WHERE d.id = $1";

/// One dataset: the task it judges for, the limits it imposes, whether it is live.
#[derive(Debug, Clone, PartialEq)]
pub struct DatasetRecord {
    /// `datasets.id`.
    pub id: i32,
    /// `datasets.task_id`, the task owning the dataset.
    pub task_id: i32,
    /// `datasets.task_type`, the name of the `TaskType` that judges it.
    pub task_type: String,
    /// `datasets.time_limit`, in seconds, absent when the dataset sets none.
    pub time_limit: Option<f64>,
    /// `datasets.memory_limit`, in bytes, absent when the dataset sets none.
    pub memory_limit: Option<i64>,
    /// `Dataset.active`: the dataset its own task points at.
    pub is_active: bool,
}

/// Maps the columns [`DATASET_BY_ID`] names onto the record.
#[must_use]
pub const fn dataset_from_row(
    id: i32,
    task_id: i32,
    task_type: String,
    time_limit: Option<f64>,
    memory_limit: Option<i64>,
    is_active: bool,
) -> DatasetRecord {
    DatasetRecord {
        id,
        task_id,
        task_type,
        time_limit,
        memory_limit,
        is_active,
    }
}

/// The columns every `testcases` row of one dataset is read with, bound to that
/// dataset's id as `$1`.
pub const TESTCASES_BY_DATASET: &str = "\
    SELECT c.id, c.dataset_id, c.codename, c.public AS is_public, c.input, c.output
    FROM testcases AS c
    WHERE c.dataset_id = $1";

/// One testcase: the codename an evaluation names it by, and the two digests.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TestcaseRecord {
    /// `testcases.id`.
    pub id: i32,
    /// `testcases.dataset_id`, the dataset the testcase belongs to.
    pub dataset_id: i32,
    /// `testcases.codename`, unique within its dataset.
    pub codename: String,
    /// `testcases.public`, whether the outcome is shown without a token.
    pub is_public: bool,
    /// `testcases.input`, the digest of the input file.
    pub input: FileDigest,
    /// `testcases.output`, the digest of the output file.
    pub output: FileDigest,
}

/// Maps the columns [`TESTCASES_BY_DATASET`] names onto the record.
///
/// # Errors
///
/// Returns [`ReadError::Digest`] naming the column when `input` or `output` holds
/// a value the `DIGEST` domain would have refused, rather than carrying a digest
/// no caller may hand to the file cache.
pub fn testcase_from_row(
    id: i32,
    dataset_id: i32,
    codename: String,
    is_public: bool,
    input: &str,
    output: &str,
) -> Result<TestcaseRecord, ReadError> {
    Ok(TestcaseRecord {
        id,
        dataset_id,
        codename,
        is_public,
        input: digest_of("testcases.input", input)?,
        output: digest_of("testcases.output", output)?,
    })
}

/// Parses one `DIGEST` column, naming the column when the domain refuses it.
fn digest_of(column: &'static str, text: &str) -> Result<FileDigest, ReadError> {
    text.parse()
        .map_err(|source| ReadError::Digest(column, source))
}
