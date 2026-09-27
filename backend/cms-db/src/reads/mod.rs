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
//! The four files below hold one entity each, so that a record is read together
//! with the query behind it:
//!
//! - `submission`: the `submissions` row, the id its query binds, and the
//!   [`SubmissionId`] that id is read as.
//! - `result`: the `submission_results` row, and the pair of ids it is read by.
//! - `dataset`: the `datasets` row, the task join that spells its active flag,
//!   and the [`DatasetId`] that id is read as.
//! - `testcase`: the `testcases` row of one dataset, and the `DIGEST` columns it
//!   carries.
//!
//! # Errors
//!
//! [`ReadError`] is the only error a mapping produces, and only
//! [`testcase_from_row`] returns it: a `DIGEST` column holding a value the domain
//! would refuse. The other three mappings are total, because every column they
//! read is already the type their record declares — the outcome and active flags
//! are computed by the projection rather than parsed out of text.
//!
//! The two ids are distinct types because both are `integer` columns and both
//! halves of every result key, so nothing that files a result can take one where
//! the other belongs.

use crate::digest::DigestError;

mod dataset;
mod result;
mod submission;
mod testcase;

pub use dataset::{dataset_from_row, DatasetId, DatasetRecord, DATASET_BY_ID};
pub use result::{result_from_row, ResultRecord, RESULT_BY_SUBMISSION_AND_DATASET};
pub use submission::{submission_from_row, SubmissionId, SubmissionRecord, SUBMISSION_BY_ID};
pub use testcase::{testcase_from_row, TestcaseRecord, TESTCASES_BY_DATASET};

/// Why a row could not be mapped onto the record beside it.
///
/// The `DIGEST` rule stays its own error rather than being flattened into the
/// driver's, so a caller can tell a column the domain would have refused from a
/// column the driver could not read at all.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ReadError {
    /// A `DIGEST` column held a value the domain would have refused: the column
    /// it was read from, and the rule it broke.
    #[error("{0} is not a digest: {1}")]
    Digest(&'static str, #[source] DigestError),
}
